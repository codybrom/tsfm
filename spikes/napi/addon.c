// Spike: a Node-API addon over tsfm's C bridge, replacing koffi for the paths
// that crashed under koffi: requests in flight at exit, dispose during a
// request, and streams abandoned mid-response.
//
// The idea being tested: every native callback goes through a
// napi_threadsafe_function owned by a heap Request, and the Request, not
// JavaScript, decides when native code may still reach JS. JavaScript can then
// drop a stream, dispose a session or exit at any point without a native
// thread ever calling into freed or unregistered memory.
//
// Build: spikes/napi/build.sh

#include <node_api.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "FoundationModels.h"

#define CHECK(call)                                                            \
  do {                                                                         \
    if ((call) != napi_ok) {                                                   \
      napi_throw_error(env, NULL, "tsfm-napi: " #call " failed");             \
      return NULL;                                                             \
    }                                                                          \
  } while (0)

// ---------------------------------------------------------------------------
// Live requests. One lock guards every request's `tsfn` field, so shutdown()
// and the per-request env cleanup hook can cut native code off from JS while
// native threads are mid-callback.

static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
static bool g_shutdown = false;

typedef struct Request {
  atomic_int refs;  // native side + threadsafe function + JS handle (streams)
  napi_threadsafe_function tsfn;  // guarded by g_lock; NULL once JS is unreachable
  bool is_stream;
  bool hook_registered;  // main thread only
  bool stream_released;  // guarded by g_lock
  bool finished;         // guarded by g_lock; the native side made its final call
  napi_env env;
  napi_deferred deferred;  // respond only; main thread only
  FMLanguageModelSessionRef session;  // retained for the request's lifetime
  const void *task;  // respond: FMTaskRef, guarded by g_lock (may arrive after the final call)
  FMLanguageModelSessionResponseStreamRef stream;  // stream: released once
  struct Request *prev, *next;  // live list, guarded by g_lock
} Request;

static Request *g_live = NULL;

static void live_add(Request *r) {
  r->prev = NULL;
  r->next = g_live;
  if (g_live) g_live->prev = r;
  g_live = r;
}

static void live_remove(Request *r) {
  if (r->prev) r->prev->next = r->next;
  else if (g_live == r) g_live = r->next;
  if (r->next) r->next->prev = r->prev;
  r->prev = r->next = NULL;
}

static void request_unref(Request *r) {
  if (atomic_fetch_sub(&r->refs, 1) == 1) free(r);
}

typedef struct {
  int status;
  char *text;  // NULL for end of stream
  bool final;
} Message;

static void message_free(Message *m) {
  if (!m) return;
  free(m->text);
  free(m);
}

// Releases the stream box exactly once. Its deinit cancels the Swift task,
// which then makes its final callback.
static void release_stream_once(Request *r) {
  bool release = false;
  pthread_mutex_lock(&g_lock);
  if (r->is_stream && !r->stream_released) {
    r->stream_released = true;
    release = true;
  }
  pthread_mutex_unlock(&g_lock);
  if (release) FMRelease(r->stream);
}

// ---------------------------------------------------------------------------
// The native callback. Runs on a Swift concurrency thread.

static void on_native(int status, const char *content, size_t length, void *user_info) {
  Request *r = user_info;
  bool final = r->is_stream ? (status != 0 || content == NULL) : true;

  Message *m = calloc(1, sizeof(Message));
  if (m) {
    m->status = status;
    m->final = final;
    if (content) m->text = strndup(content, length);
  }

  pthread_mutex_lock(&g_lock);
  if (r->tsfn && m) {
    if (napi_call_threadsafe_function(r->tsfn, m, napi_tsfn_nonblocking) != napi_ok) {
      message_free(m);
    }
  } else {
    message_free(m);
  }
  const void *task = NULL;
  if (final) {
    if (r->tsfn) napi_release_threadsafe_function(r->tsfn, napi_tsfn_release);
    r->tsfn = NULL;
    live_remove(r);
    r->finished = true;
    task = r->task;
    r->task = NULL;
  }
  pthread_mutex_unlock(&g_lock);

  if (final) {
    release_stream_once(r);
    if (task) FMRelease(task);
    FMRelease(r->session);
    request_unref(r);  // the native side's reference
  }
}

// ---------------------------------------------------------------------------
// Main-thread side of a request.

// Runs before the threadsafe function's own cleanup at env teardown (hooks run
// in reverse order of registration), so native threads stop calling it first.
static void on_env_teardown(void *arg) {
  Request *r = arg;
  r->hook_registered = false;
  pthread_mutex_lock(&g_lock);
  r->tsfn = NULL;  // the runtime closes it; native code must not touch it
  live_remove(r);
  pthread_mutex_unlock(&g_lock);
}

static void tsfn_finalize(napi_env env, void *data, void *hint) {
  (void)hint;
  Request *r = data;
  if (r->hook_registered) {
    napi_remove_env_cleanup_hook(env, on_env_teardown, r);
    r->hook_registered = false;
  }
  request_unref(r);  // the threadsafe function's reference
}

static napi_value make_error(napi_env env, int status, const char *text) {
  char code[16];
  snprintf(code, sizeof code, "%d", status);
  napi_value msg, code_value, error;
  napi_create_string_utf8(env, text ? text : "Unknown error", NAPI_AUTO_LENGTH, &msg);
  napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &code_value);
  napi_create_error(env, code_value, msg, &error);
  return error;
}

static void call_js(napi_env env, napi_value js_callback, void *context, void *data) {
  Request *r = context;
  Message *m = data;
  if (env == NULL) {  // the function is being torn down
    message_free(m);
    return;
  }
  if (r->is_stream) {
    napi_value undefined, argv[2];
    napi_get_undefined(env, &undefined);
    napi_create_int32(env, m->status, &argv[0]);
    if (m->text) napi_create_string_utf8(env, m->text, NAPI_AUTO_LENGTH, &argv[1]);
    else napi_get_null(env, &argv[1]);
    napi_call_function(env, undefined, js_callback, 2, argv, NULL);
  } else if (r->deferred) {
    if (m->status == 0) {
      napi_value text;
      napi_create_string_utf8(env, m->text ? m->text : "", NAPI_AUTO_LENGTH, &text);
      napi_resolve_deferred(env, r->deferred, text);
    } else {
      napi_reject_deferred(env, r->deferred, make_error(env, m->status, m->text));
    }
    r->deferred = NULL;
  }
  message_free(m);
}

// ---------------------------------------------------------------------------
// Sessions. A JS external holds the session; requests retain it themselves,
// so dispose() never frees a session a request is using.

typedef struct {
  FMLanguageModelSessionRef ref;
  bool disposed;
} SessionBox;

static void session_finalize(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  SessionBox *box = data;
  if (!box->disposed) FMRelease(box->ref);
  free(box);
}

static SessionBox *get_session(napi_env env, napi_value value) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_external) {
    napi_throw_type_error(env, NULL, "Expected a session handle");
    return NULL;
  }
  SessionBox *box;
  napi_get_value_external(env, value, (void **)&box);
  if (box->disposed) {
    napi_throw_error(env, NULL, "Session has been disposed");
    return NULL;
  }
  return box;
}

// Copies a JS string argument, embedded NULs and all; NULL (with a thrown
// TypeError) if it isn't a string.
static char *get_string(napi_env env, napi_value value) {
  size_t length;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) {
    napi_throw_type_error(env, NULL, "Expected a string");
    return NULL;
  }
  char *text = malloc(length + 1);
  if (!text) return NULL;
  napi_get_value_string_utf8(env, value, text, length + 1, &length);
  return text;
}

static napi_value create_session(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  char *instructions = NULL;
  if (argc > 0) {
    napi_valuetype type;
    napi_typeof(env, argv[0], &type);
    if (type == napi_string && !(instructions = get_string(env, argv[0]))) return NULL;
  }
  SessionBox *box = calloc(1, sizeof(SessionBox));
  box->ref = FMLanguageModelSessionCreateFromSystemLanguageModel(NULL, instructions, NULL, 0);
  free(instructions);
  napi_value handle;
  CHECK(napi_create_external(env, box, session_finalize, NULL, &handle));
  return handle;
}

static napi_value dispose_session(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  napi_valuetype type;
  if (argc < 1 || napi_typeof(env, argv[0], &type) != napi_ok || type != napi_external) {
    napi_throw_type_error(env, NULL, "Expected a session handle");
    return NULL;
  }
  SessionBox *box;
  napi_get_value_external(env, argv[0], (void **)&box);
  if (!box->disposed) {
    box->disposed = true;
    FMRelease(box->ref);
  }
  return NULL;
}

// ---------------------------------------------------------------------------
// Requests

static Request *start_request(napi_env env, SessionBox *box, napi_value js_callback,
                              bool is_stream) {
  Request *r = calloc(1, sizeof(Request));
  atomic_init(&r->refs, 2);  // native side + threadsafe function
  r->is_stream = is_stream;
  r->env = env;
  r->session = box->ref;
  FMRetain(r->session);

  napi_value name;
  napi_create_string_utf8(env, "tsfm-napi request", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, js_callback, NULL, name, 0, 1, r, tsfn_finalize, r,
                                      call_js, &r->tsfn) != napi_ok) {
    FMRelease(r->session);
    free(r);
    napi_throw_error(env, NULL, "tsfm-napi: couldn't create a threadsafe function");
    return NULL;
  }
  napi_add_env_cleanup_hook(env, on_env_teardown, r);
  r->hook_registered = true;

  pthread_mutex_lock(&g_lock);
  if (g_shutdown) {
    napi_release_threadsafe_function(r->tsfn, napi_tsfn_abort);
    r->tsfn = NULL;
  } else {
    live_add(r);
  }
  pthread_mutex_unlock(&g_lock);
  return r;
}

static napi_value respond(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 2) {
    napi_throw_type_error(env, NULL, "respond(session, prompt)");
    return NULL;
  }
  SessionBox *box = get_session(env, argv[0]);
  if (!box) return NULL;
  char *prompt = get_string(env, argv[1]);
  if (!prompt) return NULL;

  napi_value promise;
  napi_deferred deferred;
  CHECK(napi_create_promise(env, &deferred, &promise));
  Request *r = start_request(env, box, NULL, false);
  if (!r) {
    free(prompt);
    return NULL;
  }
  r->deferred = deferred;

  FMComposedPrompt composed = FMComposedPromptInitialize();
  FMComposedPromptAddText(composed, prompt);
  free(prompt);
  // Retain across the call: the response can finish, and drop the native
  // side's reference, before FMLanguageModelSessionRespond returns.
  atomic_fetch_add(&r->refs, 1);
  const void *task = FMLanguageModelSessionRespond(r->session, composed, NULL, r, on_native);
  FMRelease(composed);
  pthread_mutex_lock(&g_lock);
  bool finished = r->finished;
  if (!finished) r->task = task;
  pthread_mutex_unlock(&g_lock);
  if (finished) FMRelease(task);
  request_unref(r);
  return promise;
}

static void stream_handle_finalize(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  request_unref(data);  // the JS handle's reference
}

static napi_value stream(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  napi_valuetype callback_type = napi_undefined;
  if (argc >= 3) napi_typeof(env, argv[2], &callback_type);
  if (argc < 3 || callback_type != napi_function) {
    napi_throw_type_error(env, NULL, "stream(session, prompt, onChunk)");
    return NULL;
  }
  SessionBox *box = get_session(env, argv[0]);
  if (!box) return NULL;
  char *prompt = get_string(env, argv[1]);
  if (!prompt) return NULL;

  Request *r = start_request(env, box, argv[2], true);
  if (!r) {
    free(prompt);
    return NULL;
  }
  atomic_fetch_add(&r->refs, 1);  // the JS handle
  napi_value handle;
  CHECK(napi_create_external(env, r, stream_handle_finalize, NULL, &handle));

  FMComposedPrompt composed = FMComposedPromptInitialize();
  FMComposedPromptAddText(composed, prompt);
  free(prompt);
  r->stream = FMLanguageModelSessionStreamResponse(r->session, composed, NULL);
  FMRelease(composed);
  FMLanguageModelSessionResponseStreamIterate(r->stream, r, on_native);
  return handle;
}

// Stops a stream. The native side still makes its final call, which the
// Request absorbs; JavaScript needs no bookkeeping.
static napi_value cancel_stream(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  napi_valuetype type;
  if (argc < 1 || napi_typeof(env, argv[0], &type) != napi_ok || type != napi_external) {
    napi_throw_type_error(env, NULL, "Expected a stream handle");
    return NULL;
  }
  Request *r;
  napi_get_value_external(env, argv[0], (void **)&r);
  release_stream_once(r);
  return NULL;
}

// Called from process.on("exit"): cut every in-flight request off from JS
// before the environment goes away, since process.exit() skips the env
// cleanup hooks.
static napi_value shutdown(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  pthread_mutex_lock(&g_lock);
  g_shutdown = true;
  for (Request *r = g_live; r; r = r->next) {
    if (r->tsfn) {
      napi_release_threadsafe_function(r->tsfn, napi_tsfn_abort);
      r->tsfn = NULL;
    }
  }
  g_live = NULL;
  pthread_mutex_unlock(&g_lock);
  return NULL;
}

static napi_value is_available(napi_env env, napi_callback_info info) {
  (void)info;
  FMSystemLanguageModelRef model = FMSystemLanguageModelCreate(
      FMSystemLanguageModelUseCaseGeneral, FMSystemLanguageModelGuardrailsDefault);
  bool available = FMSystemLanguageModelIsAvailable(model, NULL);
  FMRelease(model);
  napi_value result;
  napi_get_boolean(env, available, &result);
  return result;
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_property_descriptor props[] = {
      {"isAvailable", NULL, is_available, NULL, NULL, NULL, napi_default, NULL},
      {"createSession", NULL, create_session, NULL, NULL, NULL, napi_default, NULL},
      {"disposeSession", NULL, dispose_session, NULL, NULL, NULL, napi_default, NULL},
      {"respond", NULL, respond, NULL, NULL, NULL, napi_default, NULL},
      {"stream", NULL, stream, NULL, NULL, NULL, napi_default, NULL},
      {"cancelStream", NULL, cancel_stream, NULL, NULL, NULL, napi_default, NULL},
      {"shutdown", NULL, shutdown, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof props / sizeof *props, props);
  return exports;
}
