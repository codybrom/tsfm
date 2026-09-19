// tsfm's Node-API binding to the Foundation Models bridge (libFoundationModels).
//
// It replaces koffi. The point is crash safety: JavaScript can pass anything,
// drop anything, dispose anything or exit at any moment, and native code never
// reads freed memory or calls into JavaScript that's gone.
//
// - Native objects reach JavaScript as type-tagged externals (Handle) with a
//   kind. A wrong kind, a foreign external or a released handle throws a
//   TypeError or Error instead of reaching Swift.
// - Strings are read with napi_get_value_string_utf8, which throws a TypeError
//   for a non-string. Strings the bridge allocates are copied and freed here.
// - Every native-to-JavaScript call goes through a napi_threadsafe_function
//   owned by a heap Request (one-shot requests and streams) or ToolBox
//   (persistent tool callbacks). Under one lock, those decide when native code
//   may still reach JavaScript: after shutdown(), an env teardown or a release,
//   native callbacks are absorbed here instead.
//
// Exports are named after the C functions they wrap; see src/bindings.ts for
// their JavaScript shapes.

#include <node_api.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "FoundationModels.h"

// Status codes shared with src/errors.ts (GenerationErrorCode).
enum { STATUS_OK = 0, STATUS_UNKNOWN = 255 };

// ---------------------------------------------------------------------------
// Utilities

#define NAPI_OK(call)                                                          \
  do {                                                                         \
    if ((call) != napi_ok) {                                                   \
      throw_last_error(env, #call);                                            \
      return NULL;                                                             \
    }                                                                          \
  } while (0)

static void throw_last_error(napi_env env, const char *what) {
  bool pending = false;
  napi_is_exception_pending(env, &pending);
  if (pending) return;
  char message[256];
  snprintf(message, sizeof message, "tsfm: %s failed", what);
  napi_throw_error(env, NULL, message);
}

static napi_value js_null(napi_env env) {
  napi_value v;
  napi_get_null(env, &v);
  return v;
}

static napi_value js_undefined(napi_env env) {
  napi_value v;
  napi_get_undefined(env, &v);
  return v;
}

static napi_value js_bool(napi_env env, bool b) {
  napi_value v;
  napi_get_boolean(env, b, &v);
  return v;
}

static napi_value js_int(napi_env env, int32_t n) {
  napi_value v;
  napi_create_int32(env, n, &v);
  return v;
}

static napi_value js_string(napi_env env, const char *s) {
  if (!s) return js_null(env);
  napi_value v;
  if (napi_create_string_utf8(env, s, NAPI_AUTO_LENGTH, &v) != napi_ok) return js_null(env);
  return v;
}

/// A string the bridge allocated, as a JS string (or null); frees it.
static napi_value js_string_take(napi_env env, char *s) {
  napi_value v = js_string(env, s);
  if (s) FMFreeString(s);
  return v;
}

static void set_prop(napi_env env, napi_value obj, const char *name, napi_value value) {
  napi_set_named_property(env, obj, name, value);
}

static bool is_nullish(napi_env env, napi_value v) {
  napi_valuetype t;
  if (napi_typeof(env, v, &t) != napi_ok) return false;
  return t == napi_null || t == napi_undefined;
}

/// Copies a JS string argument (embedded NULs included). With `nullable`, null
/// and undefined give NULL. Otherwise throws a TypeError naming `name`.
static bool get_string(napi_env env, napi_value v, const char *name, bool nullable, char **out) {
  *out = NULL;
  if (nullable && is_nullish(env, v)) return true;
  size_t length;
  if (napi_get_value_string_utf8(env, v, NULL, 0, &length) != napi_ok) {
    char message[160];
    snprintf(message, sizeof message, "Expected a string for \"%s\"", name);
    napi_throw_type_error(env, NULL, message);
    return false;
  }
  char *s = malloc(length + 1);
  if (!s) {
    napi_throw_error(env, NULL, "tsfm: out of memory");
    return false;
  }
  if (napi_get_value_string_utf8(env, v, s, length + 1, &length) != napi_ok) {
    free(s);
    throw_last_error(env, "reading a string");
    return false;
  }
  *out = s;
  return true;
}

static bool get_number(napi_env env, napi_value v, const char *name, double *out) {
  if (napi_get_value_double(env, v, out) != napi_ok) {
    char message[160];
    snprintf(message, sizeof message, "Expected a number for \"%s\"", name);
    napi_throw_type_error(env, NULL, message);
    return false;
  }
  return true;
}

/// Reads an int32. napi_get_value_int32 would wrap large values and read NaN or
/// infinity as 0, so read a double and reject anything that isn't an int32.
static bool get_int(napi_env env, napi_value v, const char *name, int32_t *out) {
  double value;
  char message[160];
  if (napi_get_value_double(env, v, &value) != napi_ok) {
    snprintf(message, sizeof message, "Expected an integer for \"%s\"", name);
    napi_throw_type_error(env, NULL, message);
    return false;
  }
  if (!(value >= INT32_MIN && value <= INT32_MAX) || value != (double)(int32_t)value) {
    snprintf(message, sizeof message, "\"%s\" must be a 32-bit integer", name);
    napi_throw_range_error(env, NULL, message);
    return false;
  }
  *out = (int32_t)value;
  return true;
}

static bool get_bool(napi_env env, napi_value v, const char *name, bool *out) {
  if (napi_get_value_bool(env, v, out) != napi_ok) {
    char message[160];
    snprintf(message, sizeof message, "Expected a boolean for \"%s\"", name);
    napi_throw_type_error(env, NULL, message);
    return false;
  }
  return true;
}

/// Reads up to `max` arguments; missing ones are undefined.
#define ARGS(n)                                                                \
  size_t argc = (n);                                                           \
  napi_value argv[(n) > 0 ? (n) : 1];                                          \
  NAPI_OK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));               \
  for (size_t i_ = argc; i_ < (size_t)(n); i_++) argv[i_] = js_undefined(env);

// ---------------------------------------------------------------------------
// Handles

typedef enum {
  K_MODEL = 1,
  K_PCC,
  K_SESSION,
  K_PROMPT,
  K_SCHEMA,
  K_PROPERTY,
  K_CONTENT,
  K_TOOL,
  K_REQUEST,
} Kind;

static const char *kind_name(Kind k) {
  switch (k) {
    case K_MODEL: return "SystemLanguageModel";
    case K_PCC: return "PrivateCloudComputeLanguageModel";
    case K_SESSION: return "LanguageModelSession";
    case K_PROMPT: return "prompt";
    case K_SCHEMA: return "GenerationSchema";
    case K_PROPERTY: return "GenerationSchemaProperty";
    case K_CONTENT: return "GeneratedContent";
    case K_TOOL: return "Tool";
    case K_REQUEST: return "request";
  }
  return "native object";
}

// Marks tsfm's externals, so another addon's external is never read as one.
static const napi_type_tag HANDLE_TAG = {0x7473666d2d68616eULL, 0x646c652d762d3031ULL};

struct ToolBox;
struct Request;

typedef struct {
  Kind kind;
  const void *ptr;       // the bridge object (retained +1), or NULL for requests
  bool released;         // main thread only
  struct ToolBox *tool;  // K_TOOL: the tool's callback box
  struct Request *req;   // K_REQUEST
} Handle;

static void tool_handle_released(struct ToolBox *box);
static void request_unref(struct Request *r);

static void release_handle(Handle *h) {
  if (h->released) return;
  h->released = true;
  if (h->kind == K_TOOL && h->tool) {
    tool_handle_released(h->tool);
    h->tool = NULL;
  }
  if (h->kind == K_REQUEST && h->req) {
    request_unref(h->req);
    h->req = NULL;
  }
  if (h->ptr) FMRelease(h->ptr);
}

static void handle_finalize(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  Handle *h = data;
  release_handle(h);
  free(h);
}

/// Wraps a retained bridge object; NULL gives JS null. Releases `ptr` if
/// wrapping fails.
static napi_value make_handle(napi_env env, Kind kind, const void *ptr) {
  if (!ptr && kind != K_REQUEST) return js_null(env);
  Handle *h = calloc(1, sizeof(Handle));
  if (!h) {
    if (ptr) FMRelease(ptr);
    napi_throw_error(env, NULL, "tsfm: out of memory");
    return NULL;
  }
  h->kind = kind;
  h->ptr = ptr;
  napi_value v;
  if (napi_create_external(env, h, handle_finalize, NULL, &v) != napi_ok) {
    if (ptr) FMRelease(ptr);
    free(h);
    throw_last_error(env, "creating a handle");
    return NULL;
  }
  if (napi_type_tag_object(env, v, &HANDLE_TAG) != napi_ok) {
    // The external exists and its finalizer will free `h`, so only release
    // the object here and leave the handle released.
    if (ptr) FMRelease(ptr);
    h->ptr = NULL;
    h->released = true;
    throw_last_error(env, "creating a handle");
    return NULL;
  }
  return v;
}

/// The Handle of `kind` in `v`, or NULL with a thrown error. With `nullable`,
/// null and undefined give *out = NULL and return true.
static bool get_handle(napi_env env, napi_value v, Kind kind, bool nullable, Handle **out) {
  *out = NULL;
  if (nullable && is_nullish(env, v)) return true;
  napi_valuetype t;
  bool tagged = false;
  if (napi_typeof(env, v, &t) != napi_ok || t != napi_external ||
      napi_check_object_type_tag(env, v, &HANDLE_TAG, &tagged) != napi_ok || !tagged) {
    char message[160];
    snprintf(message, sizeof message, "Expected a %s handle", kind_name(kind));
    napi_throw_type_error(env, NULL, message);
    return false;
  }
  Handle *h;
  napi_get_value_external(env, v, (void **)&h);
  if (h->kind != kind) {
    char message[200];
    snprintf(message, sizeof message, "Expected a %s handle, got a %s handle", kind_name(kind),
             kind_name(h->kind));
    napi_throw_type_error(env, NULL, message);
    return false;
  }
  if (h->released) {
    char message[160];
    snprintf(message, sizeof message, "The %s has been released", kind_name(kind));
    napi_throw_error(env, NULL, message);
    return false;
  }
  *out = h;
  return true;
}

/// The bridge pointer of a handle argument, or NULL (with a thrown error, or
/// for a null nullable argument; check napi_is_exception_pending if needed).
#define PTR(v, kind, nullable, out)                                            \
  const void *out = NULL;                                                      \
  do {                                                                         \
    Handle *h_;                                                                \
    if (!get_handle(env, (v), (kind), (nullable), &h_)) return NULL;           \
    out = h_ ? h_->ptr : NULL;                                                 \
  } while (0)

/// { value, status, description } for calls with out-parameter errors.
static napi_value make_result(napi_env env, napi_value value, int status, char *description) {
  napi_value obj;
  napi_create_object(env, &obj);
  set_prop(env, obj, "value", value ? value : js_null(env));
  set_prop(env, obj, "status", js_int(env, status));
  set_prop(env, obj, "description", js_string_take(env, description));
  return obj;
}

/// Copies an array of Tool handles into a C array of bridge pointers. Callers
/// read it before any other handle argument: it can run JavaScript.
static bool get_tools(napi_env env, napi_value v, FMBridgedToolRef **out, int *count) {
  *out = NULL;
  *count = 0;
  if (is_nullish(env, v)) return true;
  bool is_array = false;
  napi_is_array(env, v, &is_array);
  if (!is_array) {
    napi_throw_type_error(env, NULL, "Expected an array of Tool handles");
    return false;
  }
  uint32_t length = 0;
  napi_get_array_length(env, v, &length);
  if (length == 0) return true;
  FMBridgedToolRef *tools = calloc(length, sizeof(FMBridgedToolRef));
  napi_value *items = calloc(length, sizeof(napi_value));
  if (!tools || !items) {
    free(tools);
    free(items);
    napi_throw_error(env, NULL, "tsfm: out of memory");
    return false;
  }
  // Reading an element can run JavaScript (an accessor can dispose a tool), so
  // read them all before checking any handle; checks run no JavaScript.
  for (uint32_t i = 0; i < length; i++) {
    if (napi_get_element(env, v, i, &items[i]) != napi_ok) {
      free(tools);
      free(items);
      throw_last_error(env, "reading the tools");
      return false;
    }
  }
  for (uint32_t i = 0; i < length; i++) {
    Handle *h;
    if (!get_handle(env, items[i], K_TOOL, false, &h)) {
      free(tools);
      free(items);
      return false;
    }
    tools[i] = h->ptr;
  }
  free(items);
  *out = tools;
  *count = (int)length;
  return true;
}

// ---------------------------------------------------------------------------
// Live native-to-JS channels. One lock guards every Request's and ToolBox's
// `tsfn`, so shutdown(), env teardown and releases can cut native code off from
// JavaScript while native threads are mid-callback.

static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;

// Each env (the main thread and every worker) has its own lists and shutdown
// flag, so one worker exiting doesn't cut off the others. Guarded by g_lock.
typedef struct EnvState {
  bool shutdown;
  struct Request *requests;
  struct ToolBox *tools;
} EnvState;

static EnvState *env_state(napi_env env) {
  EnvState *state = NULL;
  napi_get_instance_data(env, (void **)&state);
  return state;
}

// ---------------------------------------------------------------------------
// Requests: respond, structured respond, stream, token counts, context size.

typedef enum { R_TEXT, R_STRUCTURED, R_COUNT, R_STREAM } RequestKind;

typedef struct Request {
  atomic_int refs;  // native side + threadsafe function + JS handle
  RequestKind kind;
  napi_threadsafe_function tsfn;  // guarded by g_lock; NULL once JS is unreachable
  bool hook_registered;           // main thread only
  bool finished;                  // guarded by g_lock: the native side's final call came
  napi_deferred deferred;         // one-shot requests; main thread only
  const void *task;               // FMTaskRef, guarded by g_lock (may arrive after finishing)
  FMLanguageModelSessionResponseStreamRef stream;  // R_STREAM
  bool stream_released;           // guarded by g_lock
  const void *retained;           // an object kept alive for the request (session/model)
  struct Message *spare;          // the final message, if allocating one fails then
  EnvState *state;                // guarded by g_lock; NULL once off the env's list
  struct Request *prev, *next;    // the env's live list, guarded by g_lock
} Request;

typedef struct Message {
  int status;
  char *text;            // R_TEXT / R_STREAM content, or an error message
  const void *content;   // R_STRUCTURED success: a retained GeneratedContent
  int count;             // R_COUNT
} Message;

static void message_free(Message *m) {
  if (!m) return;
  free(m->text);
  if (m->content) FMRelease(m->content);
  free(m);
}

/// A message for a request's native callback. If allocating fails, a final
/// message comes from the spare, so the request still ends; a non-final one
/// is NULL and dropped.
static Message *message_new(Request *r, bool final) {
  Message *m = calloc(1, sizeof(Message));
  if (!m && final) {
    m = r->spare;
    r->spare = NULL;
  }
  return m;
}

/// Lock held.
static void request_list_add(EnvState *state, Request *r) {
  r->state = state;
  r->prev = NULL;
  r->next = state->requests;
  if (state->requests) state->requests->prev = r;
  state->requests = r;
}

/// Lock held.
static void request_list_remove(Request *r) {
  if (r->state) {
    if (r->prev) r->prev->next = r->next;
    else if (r->state->requests == r) r->state->requests = r->next;
    if (r->next) r->next->prev = r->prev;
  }
  r->state = NULL;
  r->prev = r->next = NULL;
}

static void request_unref(Request *r) {
  if (atomic_fetch_sub(&r->refs, 1) == 1) {
    message_free(r->spare);
    free(r);
  }
}

/// Releases the stream box once; its deinit cancels the Swift task, which then
/// makes its final call.
static void release_stream_once(Request *r) {
  bool release = false;
  pthread_mutex_lock(&g_lock);
  if (r->kind == R_STREAM && r->stream && !r->stream_released) {
    r->stream_released = true;
    release = true;
  }
  pthread_mutex_unlock(&g_lock);
  if (release) FMRelease(r->stream);
}

/// Hands `m` to JavaScript, or drops it once JavaScript is unreachable. On a
/// final message, ends the native side of the request. Native threads only.
static void request_deliver(Request *r, Message *m, bool final) {
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
    request_list_remove(r);
    r->finished = true;
    task = r->task;
    r->task = NULL;
  }
  pthread_mutex_unlock(&g_lock);
  if (final) {
    release_stream_once(r);
    if (task) FMRelease(task);
    if (r->retained) FMRelease(r->retained);
    request_unref(r);  // the native side's reference
  }
}

static void on_response(int status, const char *content, size_t length, void *user_info) {
  Request *r = user_info;
  bool final = r->kind == R_STREAM ? (status != STATUS_OK || content == NULL) : true;
  Message *m = message_new(r, final);
  if (m) {
    m->status = status;
    if (content) {
      m->text = strndup(content, length);
      if (!m->text) {
        if (!final) {
          // A stream chunk with no text would read as the end; skip it.
          message_free(m);
          m = NULL;
        } else if (status == STATUS_OK) {
          m->status = STATUS_UNKNOWN;
        }
      }
    }
  }
  request_deliver(r, m, final);
}

static void on_structured(int status, FMGeneratedContentRef content, void *user_info) {
  Request *r = user_info;
  Message *m = message_new(r, true);
  if (m) {
    m->status = status;
    if (status == STATUS_OK) {
      m->content = content;  // owned by the message now
      content = NULL;
    } else if (content) {
      // On failure the bridge sends its message as the content's JSON.
      char *json = FMGeneratedContentGetJSONString(content);
      if (json) {
        m->text = strdup(json);
        FMFreeString(json);
      }
    }
  }
  if (content) FMRelease(content);
  request_deliver(r, m, true);
}

static void on_count(int status, int count, const char *description, void *user_info) {
  Request *r = user_info;
  Message *m = message_new(r, true);
  if (m) {
    m->status = status;
    m->count = count;
    if (description) m->text = strdup(description);
  }
  request_deliver(r, m, true);
}

// Runs before the threadsafe function's own cleanup at env teardown (hooks run
// in reverse order of registration), so native threads stop calling it first.
static void request_env_teardown(void *arg) {
  Request *r = arg;
  r->hook_registered = false;
  pthread_mutex_lock(&g_lock);
  r->tsfn = NULL;
  request_list_remove(r);
  pthread_mutex_unlock(&g_lock);
}

static void request_tsfn_finalize(napi_env env, void *data, void *hint) {
  (void)hint;
  Request *r = data;
  if (r->hook_registered) {
    napi_remove_env_cleanup_hook(env, request_env_teardown, r);
    r->hook_registered = false;
  }
  request_unref(r);  // the threadsafe function's reference
}

static void call_js_ignoring_exceptions(napi_env env, napi_value fn, size_t argc,
                                        const napi_value *argv) {
  napi_value undefined = js_undefined(env);
  napi_call_function(env, undefined, fn, argc, argv, NULL);
  bool pending = false;
  napi_is_exception_pending(env, &pending);
  if (pending) {
    // src/ catches inside its callbacks; an exception here is a tsfm bug, and
    // it shouldn't take the host down from a native callback.
    napi_value ignored;
    napi_get_and_clear_last_exception(env, &ignored);
  }
}

static void request_call_js(napi_env env, napi_value js_callback, void *context, void *data) {
  Request *r = context;
  Message *m = data;
  if (env == NULL) {  // the function is being torn down
    message_free(m);
    return;
  }
  if (r->kind == R_STREAM) {
    napi_value argv[2] = {js_int(env, m->status), js_string(env, m->text)};
    call_js_ignoring_exceptions(env, js_callback, 2, argv);
  } else if (r->deferred) {
    napi_value result;
    napi_create_object(env, &result);
    set_prop(env, result, "status", js_int(env, m->status));
    if (r->kind == R_TEXT) {
      set_prop(env, result, "text", js_string(env, m->text));
    } else if (r->kind == R_STRUCTURED) {
      napi_value content = js_null(env);
      if (m->content) {
        content = make_handle(env, K_CONTENT, m->content);
        m->content = NULL;  // the handle owns it (or released it on failure)
        if (!content) {
          napi_value ignored;
          napi_get_and_clear_last_exception(env, &ignored);
          content = js_null(env);
        }
      }
      set_prop(env, result, "content", content);
      set_prop(env, result, "message", js_string(env, m->text));
    } else {
      set_prop(env, result, "count", js_int(env, m->count));
      set_prop(env, result, "message", js_string(env, m->text));
    }
    napi_resolve_deferred(env, r->deferred, result);
    r->deferred = NULL;
  }
  message_free(m);
}

/// Starts a request: a threadsafe function (and a promise, for one-shot kinds),
/// and a retain on `retained` for the request's lifetime. NULL with a thrown
/// error on failure.
static Request *request_start(napi_env env, RequestKind kind, napi_value js_callback,
                              const void *retained, napi_value *promise) {
  Request *r = calloc(1, sizeof(Request));
  if (!r) {
    napi_throw_error(env, NULL, "tsfm: out of memory");
    return NULL;
  }
  atomic_init(&r->refs, 2);  // native side + threadsafe function
  r->kind = kind;
  r->spare = calloc(1, sizeof(Message));
  if (!r->spare) {
    free(r);
    napi_throw_error(env, NULL, "tsfm: out of memory");
    return NULL;
  }
  if (kind != R_STREAM) {
    if (napi_create_promise(env, &r->deferred, promise) != napi_ok) {
      free(r->spare);
      free(r);
      throw_last_error(env, "creating a promise");
      return NULL;
    }
  }
  napi_value name;
  napi_create_string_utf8(env, "tsfm request", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, kind == R_STREAM ? js_callback : NULL, NULL, name, 0, 1,
                                      r, request_tsfn_finalize, r, request_call_js,
                                      &r->tsfn) != napi_ok) {
    // The promise, if any, is never settled; the caller gets the thrown error.
    free(r->spare);
    free(r);
    throw_last_error(env, "creating a threadsafe function");
    return NULL;
  }
  napi_add_env_cleanup_hook(env, request_env_teardown, r);
  r->hook_registered = true;
  if (retained) {
    FMRetain(retained);
    r->retained = retained;
  }
  EnvState *state = env_state(env);
  pthread_mutex_lock(&g_lock);
  if (!state || state->shutdown) {
    napi_release_threadsafe_function(r->tsfn, napi_tsfn_abort);
    r->tsfn = NULL;
  } else {
    request_list_add(state, r);
  }
  pthread_mutex_unlock(&g_lock);
  return r;
}

/// Records the task a one-shot call returned. The request may already have
/// finished (and dropped the native side's reference) before the call
/// returned; the caller holds its own reference across the call.
static void request_set_task(Request *r, const void *task) {
  pthread_mutex_lock(&g_lock);
  bool finished = r->finished;
  if (!finished) r->task = task;
  pthread_mutex_unlock(&g_lock);
  if (finished && task) FMRelease(task);
}

/// A JS handle for cancelling `r`, holding a reference to it.
static napi_value request_handle(napi_env env, Request *r) {
  atomic_fetch_add(&r->refs, 1);
  napi_value v = make_handle(env, K_REQUEST, NULL);
  if (!v) {
    request_unref(r);
    return NULL;
  }
  Handle *h;
  napi_get_value_external(env, v, (void **)&h);
  h->req = r;
  return v;
}

/// [promise, request] for a started one-shot request.
static napi_value request_pair(napi_env env, napi_value promise, Request *r) {
  napi_value handle = request_handle(env, r);
  request_unref(r);  // the caller's reference, held across the native call
  if (!handle) return NULL;
  napi_value pair;
  napi_create_array_with_length(env, 2, &pair);
  napi_set_element(env, pair, 0, promise);
  napi_set_element(env, pair, 1, handle);
  return pair;
}

// ---------------------------------------------------------------------------
// Tools: persistent callbacks the model calls; JavaScript answers later.

typedef struct PendingCall {
  unsigned int id;
  struct PendingCall *next;
} PendingCall;

typedef struct ToolBox {
  atomic_int refs;  // Swift (released when the tool is freed) + threadsafe function
  napi_threadsafe_function tsfn;  // guarded by g_lock
  bool hook_registered;           // main thread only
  bool closed;                    // guarded by g_lock: the JS handle was released
  FMBridgedToolRef tool;          // guarded by g_lock
  PendingCall *pending;           // guarded by g_lock: calls sent to JS, not yet answered
  EnvState *state;                // guarded by g_lock; NULL once off the env's list
  struct ToolBox *prev, *next;    // the env's live list, guarded by g_lock
} ToolBox;

/// Lock held.
static void tool_list_add(EnvState *state, ToolBox *b) {
  b->state = state;
  b->prev = NULL;
  b->next = state->tools;
  if (state->tools) state->tools->prev = b;
  state->tools = b;
}

/// Lock held.
static void tool_list_remove(ToolBox *b) {
  if (b->state) {
    if (b->prev) b->prev->next = b->next;
    else if (b->state->tools == b) b->state->tools = b->next;
    if (b->next) b->next->prev = b->prev;
  }
  b->state = NULL;
  b->prev = b->next = NULL;
}

static void tool_unref(ToolBox *b) {
  if (atomic_fetch_sub(&b->refs, 1) != 1) return;
  PendingCall *p = b->pending;
  while (p) {
    PendingCall *next = p->next;
    free(p);
    p = next;
  }
  free(b);
}

/// Whether `id` is a pending call. Lock held.
static bool is_pending(ToolBox *b, unsigned int id) {
  for (PendingCall *p = b->pending; p; p = p->next) {
    if (p->id == id) return true;
  }
  return false;
}

/// Removes `id` from the pending calls; whether it was there. Lock held.
static bool take_pending(ToolBox *b, unsigned int id) {
  for (PendingCall **p = &b->pending; *p; p = &(*p)->next) {
    if ((*p)->id == id) {
      PendingCall *found = *p;
      *p = found->next;
      free(found);
      return true;
    }
  }
  return false;
}

typedef struct {
  FMGeneratedContentRef content;
  unsigned int id;
} ToolMessage;

static const char *TOOL_GONE = "The tool is no longer available; it was disposed or the process is exiting.";

/// Called by Swift for each tool call, on a Swift thread. The Swift side waits
/// on a continuation for this id, so every path must finish or fail it.
static void on_tool_call(FMGeneratedContentRef content, unsigned int id, void *user_info) {
  ToolBox *b = user_info;
  bool sent = false;
  pthread_mutex_lock(&g_lock);
  if (b->tsfn && !b->closed) {
    PendingCall *p = malloc(sizeof(PendingCall));
    ToolMessage *m = malloc(sizeof(ToolMessage));
    if (p && m) {
      p->id = id;
      p->next = b->pending;
      b->pending = p;
      m->content = content;
      m->id = id;
      // The queued message holds a reference: tool_call_js can run after the
      // threadsafe function's finalizer dropped its own (at env teardown).
      atomic_fetch_add(&b->refs, 1);
      if (napi_call_threadsafe_function(b->tsfn, m, napi_tsfn_nonblocking) == napi_ok) {
        sent = true;
      } else {
        // Swift's reference is held while it's inside this call, so this
        // can't be the last one.
        atomic_fetch_sub(&b->refs, 1);
        take_pending(b, id);
        free(m);
      }
    } else {
      free(p);
      free(m);
    }
  }
  FMBridgedToolRef tool = b->tool;
  pthread_mutex_unlock(&g_lock);
  if (!sent) {
    // The tool object is alive: Swift is inside its call(arguments:).
    FMBridgedToolFailCall(tool, id, STATUS_UNKNOWN, TOOL_GONE);
    FMRelease(content);
  }
}

static void tool_call_js(napi_env env, napi_value js_callback, void *context, void *data) {
  ToolBox *b = context;
  ToolMessage *m = data;
  if (env == NULL) {
    // Torn down with the call queued: nothing in JavaScript will answer it.
    pthread_mutex_lock(&g_lock);
    bool was_pending = take_pending(b, m->id);
    FMBridgedToolRef tool = b->tool;
    pthread_mutex_unlock(&g_lock);
    if (was_pending) FMBridgedToolFailCall(tool, m->id, STATUS_UNKNOWN, TOOL_GONE);
    FMRelease(m->content);
    free(m);
    tool_unref(b);  // the message's reference
    return;
  }
  // Released (and its calls failed) while this was queued: nothing to answer.
  pthread_mutex_lock(&g_lock);
  bool live = !b->closed && is_pending(b, m->id);
  pthread_mutex_unlock(&g_lock);
  if (!live) {
    FMRelease(m->content);
    free(m);
    tool_unref(b);
    return;
  }
  napi_value content = make_handle(env, K_CONTENT, m->content);
  if (!content) {
    napi_value ignored;
    napi_get_and_clear_last_exception(env, &ignored);
    content = js_null(env);
  }
  napi_value id;
  napi_create_uint32(env, m->id, &id);
  napi_value argv[2] = {content, id};
  call_js_ignoring_exceptions(env, js_callback, 2, argv);
  free(m);
  tool_unref(b);  // the message's reference
}

static void tool_env_teardown(void *arg) {
  ToolBox *b = arg;
  b->hook_registered = false;
  pthread_mutex_lock(&g_lock);
  b->tsfn = NULL;
  tool_list_remove(b);
  pthread_mutex_unlock(&g_lock);
}

static void tool_tsfn_finalize(napi_env env, void *data, void *hint) {
  (void)hint;
  ToolBox *b = data;
  if (b->hook_registered) {
    napi_remove_env_cleanup_hook(env, tool_env_teardown, b);
    b->hook_registered = false;
  }
  tool_unref(b);  // the threadsafe function's reference
}

/// Swift freed the tool: no more calls will come.
static void on_tool_freed(void *user_info) {
  ToolBox *b = user_info;
  pthread_mutex_lock(&g_lock);
  if (b->tsfn) napi_release_threadsafe_function(b->tsfn, napi_tsfn_release);
  b->tsfn = NULL;
  tool_list_remove(b);
  pthread_mutex_unlock(&g_lock);
  tool_unref(b);  // Swift's reference
}

/// The JS handle was released: later calls fail here, and calls JavaScript
/// hasn't answered are failed now, so no response waits on them forever.
static void tool_handle_released(ToolBox *b) {
  pthread_mutex_lock(&g_lock);
  b->closed = true;
  PendingCall *pending = b->pending;
  b->pending = NULL;
  FMBridgedToolRef tool = b->tool;
  pthread_mutex_unlock(&g_lock);
  while (pending) {
    PendingCall *next = pending->next;
    FMBridgedToolFailCall(tool, pending->id, STATUS_UNKNOWN, TOOL_GONE);
    free(pending);
    pending = next;
  }
}

// ---------------------------------------------------------------------------
// Exports: models

static napi_value SystemLanguageModelCreate(napi_env env, napi_callback_info info) {
  ARGS(2);
  int32_t use_case, guardrails;
  if (!get_int(env, argv[0], "useCase", &use_case) ||
      !get_int(env, argv[1], "guardrails", &guardrails)) {
    return NULL;
  }
  return make_handle(env, K_MODEL, FMSystemLanguageModelCreate(use_case, guardrails));
}

static napi_value availability(napi_env env, bool available, int reason) {
  napi_value obj;
  napi_create_object(env, &obj);
  set_prop(env, obj, "available", js_bool(env, available));
  set_prop(env, obj, "reason", available ? js_null(env) : js_int(env, reason));
  return obj;
}

static napi_value SystemLanguageModelIsAvailable(napi_env env, napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_MODEL, false, model);
  FMSystemLanguageModelUnavailableReason reason = FMSystemLanguageModelUnavailableReasonUnknown;
  bool available = FMSystemLanguageModelIsAvailable(model, &reason);
  return availability(env, available, (int)reason);
}

static napi_value SystemLanguageModelGetContextSize(napi_env env, napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_MODEL, false, model);
  return js_int(env, FMSystemLanguageModelGetContextSize(model));
}

static napi_value SystemLanguageModelGetVariantName(napi_env env, napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_MODEL, false, model);
  return js_string_take(env, FMSystemLanguageModelGetVariantName(model));
}

static napi_value SystemLanguageModelGetCapabilitiesJSON(napi_env env, napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_MODEL, false, model);
  return js_string_take(env, FMSystemLanguageModelGetCapabilitiesJSON(model));
}

static napi_value SystemLanguageModelGetSupportedLanguages(napi_env env, napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_MODEL, false, model);
  return js_string_take(env, FMSystemLanguageModelGetSupportedLanguages(model));
}

static napi_value SystemLanguageModelSupportsLocale(napi_env env, napi_callback_info info) {
  ARGS(2);
  PTR(argv[0], K_MODEL, false, model);
  char *locale;
  if (!get_string(env, argv[1], "localeIdentifier", false, &locale)) return NULL;
  bool supported = FMSystemLanguageModelSupportsLocale(model, locale);
  free(locale);
  return js_bool(env, supported);
}

static napi_value PrivateCloudComputeLanguageModelCreate(napi_env env, napi_callback_info info) {
  (void)info;
  return make_handle(env, K_PCC, FMPrivateCloudComputeLanguageModelCreate());
}

static napi_value PrivateCloudComputeLanguageModelIsAvailable(napi_env env,
                                                             napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_PCC, false, model);
  int reason = STATUS_UNKNOWN;
  bool available = FMPrivateCloudComputeLanguageModelIsAvailable((void *)model, &reason);
  return availability(env, available, reason);
}

static napi_value PrivateCloudComputeLanguageModelGetCapabilitiesJSON(napi_env env,
                                                                     napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_PCC, false, model);
  return js_string_take(env, FMPrivateCloudComputeLanguageModelGetCapabilitiesJSON((void *)model));
}

static napi_value PrivateCloudComputeLanguageModelGetQuotaUsageJSON(napi_env env,
                                                                   napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_PCC, false, model);
  return js_string_take(env, FMPrivateCloudComputeLanguageModelGetQuotaUsageJSON((void *)model));
}

// ---------------------------------------------------------------------------
// Exports: sessions

static napi_value SessionCreate(napi_env env, napi_callback_info info, bool pcc) {
  ARGS(3);
  FMBridgedToolRef *tools;
  int count;
  if (!get_tools(env, argv[2], &tools, &count)) return NULL;
  Handle *model_handle;
  char *instructions;
  if (!get_handle(env, argv[0], pcc ? K_PCC : K_MODEL, !pcc, &model_handle) ||
      !get_string(env, argv[1], "instructions", true, &instructions)) {
    free(tools);
    return NULL;
  }
  const void *model = model_handle ? model_handle->ptr : NULL;
  const void *session =
      pcc ? FMLanguageModelSessionCreateFromPrivateCloudComputeModel((void *)model, instructions,
                                                                     tools, count)
          : FMLanguageModelSessionCreateFromSystemLanguageModel(model, instructions, tools, count);
  free(instructions);
  free(tools);
  return make_handle(env, K_SESSION, session);
}

static napi_value LanguageModelSessionCreateFromSystemLanguageModel(napi_env env,
                                                                   napi_callback_info info) {
  return SessionCreate(env, info, false);
}

static napi_value LanguageModelSessionCreateFromPrivateCloudComputeModel(napi_env env,
                                                                        napi_callback_info info) {
  return SessionCreate(env, info, true);
}

static napi_value SessionCreateFromTranscript(napi_env env, napi_callback_info info, bool pcc) {
  ARGS(3);
  FMBridgedToolRef *tools;
  int count;
  if (!get_tools(env, argv[2], &tools, &count)) return NULL;
  Handle *transcript_handle, *model_handle;
  if (!get_handle(env, argv[0], K_SESSION, false, &transcript_handle) ||
      !get_handle(env, argv[1], pcc ? K_PCC : K_MODEL, !pcc, &model_handle)) {
    free(tools);
    return NULL;
  }
  const void *transcript = transcript_handle->ptr;
  const void *model = model_handle ? model_handle->ptr : NULL;
  const void *session =
      pcc ? FMLanguageModelSessionCreateFromTranscriptWithPrivateCloudComputeModel(
                transcript, (void *)model, tools, count)
          : FMLanguageModelSessionCreateFromTranscript(transcript, model, tools, count);
  free(tools);
  return make_handle(env, K_SESSION, session);
}

static napi_value LanguageModelSessionCreateFromTranscript(napi_env env, napi_callback_info info) {
  return SessionCreateFromTranscript(env, info, false);
}

static napi_value LanguageModelSessionCreateFromTranscriptWithPrivateCloudComputeModel(
    napi_env env, napi_callback_info info) {
  return SessionCreateFromTranscript(env, info, true);
}

static napi_value LanguageModelSessionIsResponding(napi_env env, napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_SESSION, false, session);
  return js_bool(env, FMLanguageModelSessionIsResponding(session));
}

static napi_value LanguageModelSessionReset(napi_env env, napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_SESSION, false, session);
  FMLanguageModelSessionReset(session);
  return js_undefined(env);
}

static napi_value LanguageModelSessionPrewarm(napi_env env, napi_callback_info info) {
  ARGS(2);
  PTR(argv[0], K_SESSION, false, session);
  char *prefix;
  if (!get_string(env, argv[1], "promptPrefix", true, &prefix)) return NULL;
  FMLanguageModelSessionPrewarm(session, prefix);
  free(prefix);
  return js_undefined(env);
}

static napi_value LanguageModelSessionGetUsageJSON(napi_env env, napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_SESSION, false, session);
  return js_string_take(env, FMLanguageModelSessionGetUsageJSON(session));
}

static napi_value LanguageModelSessionGetTranscriptJSONString(napi_env env,
                                                             napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_SESSION, false, session);
  int status = STATUS_OK;
  char *description = NULL;
  char *json = FMLanguageModelSessionGetTranscriptJSONString(session, &status, &description);
  return make_result(env, js_string_take(env, json), json ? STATUS_OK : status, description);
}

static napi_value TranscriptCreateFromJSONString(napi_env env, napi_callback_info info) {
  ARGS(1);
  char *json;
  if (!get_string(env, argv[0], "jsonString", false, &json)) return NULL;
  int status = STATUS_OK;
  char *description = NULL;
  const void *session = FMTranscriptCreateFromJSONString(json, &status, &description);
  free(json);
  napi_value value = make_handle(env, K_SESSION, session);
  if (!value) {
    if (description) FMFreeString(description);
    return NULL;
  }
  return make_result(env, value, session ? STATUS_OK : status, description);
}

// ---------------------------------------------------------------------------
// Exports: prompts

static napi_value ComposedPromptInitialize(napi_env env, napi_callback_info info) {
  (void)info;
  return make_handle(env, K_PROMPT, FMComposedPromptInitialize());
}

static napi_value ComposedPromptAddText(napi_env env, napi_callback_info info) {
  ARGS(2);
  PTR(argv[0], K_PROMPT, false, prompt);
  char *text;
  if (!get_string(env, argv[1], "text", false, &text)) return NULL;
  FMComposedPromptAddText(prompt, text);
  free(text);
  return js_undefined(env);
}

/// 0 when added, otherwise the FMComposedPromptAddImageError code.
static napi_value ComposedPromptAddAttachment(napi_env env, napi_callback_info info) {
  ARGS(3);
  PTR(argv[0], K_PROMPT, false, prompt);
  char *path, *label;
  if (!get_string(env, argv[1], "imagePath", false, &path)) return NULL;
  if (!get_string(env, argv[2], "label", true, &label)) {
    free(path);
    return NULL;
  }
  FMComposedPromptAddImageError error = FMComposedPromptAddImageErrorUnknown;
  bool added = FMComposedPromptAddAttachment(prompt, path, label, &error);
  free(path);
  free(label);
  return js_int(env, added ? 0 : (int)error);
}

// ---------------------------------------------------------------------------
// Exports: schemas and generated content

static napi_value GenerationSchemaCreate(napi_env env, napi_callback_info info) {
  ARGS(2);
  char *name, *description;
  if (!get_string(env, argv[0], "name", false, &name)) return NULL;
  if (!get_string(env, argv[1], "description", true, &description)) {
    free(name);
    return NULL;
  }
  const void *schema = FMGenerationSchemaCreate(name, description);
  free(name);
  free(description);
  return make_handle(env, K_SCHEMA, schema);
}

static napi_value GenerationSchemaPropertyCreate(napi_env env, napi_callback_info info) {
  ARGS(4);
  char *name, *description, *type_name;
  bool optional;
  if (!get_string(env, argv[0], "name", false, &name)) return NULL;
  if (!get_string(env, argv[1], "description", true, &description)) {
    free(name);
    return NULL;
  }
  if (!get_string(env, argv[2], "typeName", false, &type_name)) {
    free(name);
    free(description);
    return NULL;
  }
  if (!get_bool(env, argv[3], "isOptional", &optional)) {
    free(name);
    free(description);
    free(type_name);
    return NULL;
  }
  const void *property = FMGenerationSchemaPropertyCreate(name, description, type_name, optional);
  free(name);
  free(description);
  free(type_name);
  return make_handle(env, K_PROPERTY, property);
}

static napi_value GenerationSchemaAddProperty(napi_env env, napi_callback_info info) {
  ARGS(2);
  PTR(argv[0], K_SCHEMA, false, schema);
  PTR(argv[1], K_PROPERTY, false, property);
  FMGenerationSchemaAddProperty(schema, property);
  return js_undefined(env);
}

static napi_value GenerationSchemaAddReferenceSchema(napi_env env, napi_callback_info info) {
  ARGS(2);
  PTR(argv[0], K_SCHEMA, false, schema);
  PTR(argv[1], K_SCHEMA, false, reference);
  FMGenerationSchemaAddReferenceSchema(schema, reference);
  return js_undefined(env);
}

static napi_value GenerationSchemaGetJSONString(napi_env env, napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_SCHEMA, false, schema);
  int status = STATUS_OK;
  char *description = NULL;
  char *json = FMGenerationSchemaGetJSONString(schema, &status, &description);
  return make_result(env, js_string_take(env, json), json ? STATUS_OK : status, description);
}

static napi_value PropertyAddAnyOfGuide(napi_env env, napi_callback_info info) {
  ARGS(3);
  bool wrapped;
  if (!get_bool(env, argv[2], "wrapped", &wrapped)) return NULL;
  bool is_array = false;
  napi_is_array(env, argv[1], &is_array);
  if (!is_array) {
    napi_throw_type_error(env, NULL, "Expected an array of strings for \"anyOf\"");
    return NULL;
  }
  uint32_t length = 0;
  napi_get_array_length(env, argv[1], &length);
  char **choices = calloc(length ? length : 1, sizeof(char *));
  if (!choices) {
    napi_throw_error(env, NULL, "tsfm: out of memory");
    return NULL;
  }
  // Reading an element can run JavaScript (an accessor can dispose the
  // property), so read the choices before checking the property's handle.
  bool ok = true;
  for (uint32_t i = 0; i < length && ok; i++) {
    napi_value item;
    ok = napi_get_element(env, argv[1], i, &item) == napi_ok &&
         get_string(env, item, "anyOf", false, &choices[i]);
  }
  Handle *property_handle = NULL;
  ok = ok && get_handle(env, argv[0], K_PROPERTY, false, &property_handle);
  if (ok) {
    const void *property = property_handle->ptr;
    FMGenerationSchemaPropertyAddAnyOfGuide(property, (const char **)choices, (int)length, wrapped);
  }
  for (uint32_t i = 0; i < length; i++) free(choices[i]);
  free(choices);
  return ok ? js_undefined(env) : NULL;
}

static napi_value PropertyAddCountGuide(napi_env env, napi_callback_info info) {
  ARGS(3);
  PTR(argv[0], K_PROPERTY, false, property);
  int32_t count;
  bool wrapped;
  if (!get_int(env, argv[1], "count", &count) || !get_bool(env, argv[2], "wrapped", &wrapped)) {
    return NULL;
  }
  FMGenerationSchemaPropertyAddCountGuide(property, count, wrapped);
  return js_undefined(env);
}

static napi_value PropertyAddItemsGuide(napi_env env, napi_callback_info info, bool max) {
  ARGS(2);
  PTR(argv[0], K_PROPERTY, false, property);
  int32_t count;
  if (!get_int(env, argv[1], max ? "maxItems" : "minItems", &count)) return NULL;
  if (max) FMGenerationSchemaPropertyAddMaxItemsGuide(property, count);
  else FMGenerationSchemaPropertyAddMinItemsGuide(property, count);
  return js_undefined(env);
}

static napi_value PropertyAddMaxItemsGuide(napi_env env, napi_callback_info info) {
  return PropertyAddItemsGuide(env, info, true);
}

static napi_value PropertyAddMinItemsGuide(napi_env env, napi_callback_info info) {
  return PropertyAddItemsGuide(env, info, false);
}

static napi_value PropertyAddBoundGuide(napi_env env, napi_callback_info info, bool maximum) {
  ARGS(3);
  PTR(argv[0], K_PROPERTY, false, property);
  double value;
  bool wrapped;
  if (!get_number(env, argv[1], maximum ? "maximum" : "minimum", &value) ||
      !get_bool(env, argv[2], "wrapped", &wrapped)) {
    return NULL;
  }
  if (maximum) FMGenerationSchemaPropertyAddMaximumGuide(property, value, wrapped);
  else FMGenerationSchemaPropertyAddMinimumGuide(property, value, wrapped);
  return js_undefined(env);
}

static napi_value PropertyAddMaximumGuide(napi_env env, napi_callback_info info) {
  return PropertyAddBoundGuide(env, info, true);
}

static napi_value PropertyAddMinimumGuide(napi_env env, napi_callback_info info) {
  return PropertyAddBoundGuide(env, info, false);
}

static napi_value PropertyAddRangeGuide(napi_env env, napi_callback_info info) {
  ARGS(4);
  PTR(argv[0], K_PROPERTY, false, property);
  double min, max;
  bool wrapped;
  if (!get_number(env, argv[1], "min", &min) || !get_number(env, argv[2], "max", &max) ||
      !get_bool(env, argv[3], "wrapped", &wrapped)) {
    return NULL;
  }
  FMGenerationSchemaPropertyAddRangeGuide(property, min, max, wrapped);
  return js_undefined(env);
}

static napi_value PropertyAddRegex(napi_env env, napi_callback_info info) {
  ARGS(3);
  PTR(argv[0], K_PROPERTY, false, property);
  char *pattern;
  bool wrapped;
  if (!get_string(env, argv[1], "pattern", false, &pattern)) return NULL;
  if (!get_bool(env, argv[2], "wrapped", &wrapped)) {
    free(pattern);
    return NULL;
  }
  FMGenerationSchemaPropertyAddRegex(property, pattern, wrapped);
  free(pattern);
  return js_undefined(env);
}

static napi_value GeneratedContentCreateFromJSON(napi_env env, napi_callback_info info) {
  ARGS(1);
  char *json;
  if (!get_string(env, argv[0], "jsonString", false, &json)) return NULL;
  int status = STATUS_OK;
  char *description = NULL;
  const void *content = FMGeneratedContentCreateFromJSON(json, &status, &description);
  free(json);
  napi_value value = make_handle(env, K_CONTENT, content);
  if (!value) {
    if (description) FMFreeString(description);
    return NULL;
  }
  return make_result(env, value, content ? STATUS_OK : status, description);
}

static napi_value GeneratedContentIsComplete(napi_env env, napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_CONTENT, false, content);
  return js_bool(env, FMGeneratedContentIsComplete(content));
}

static napi_value GeneratedContentGetJSONString(napi_env env, napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_CONTENT, false, content);
  return js_string_take(env, FMGeneratedContentGetJSONString(content));
}

static napi_value GeneratedContentGetPropertyValue(napi_env env, napi_callback_info info) {
  ARGS(2);
  PTR(argv[0], K_CONTENT, false, content);
  char *name;
  if (!get_string(env, argv[1], "propertyName", false, &name)) return NULL;
  int status = STATUS_OK;
  char *description = NULL;
  char *value = FMGeneratedContentGetPropertyValue(content, name, &status, &description);
  free(name);
  return make_result(env, js_string_take(env, value), value ? STATUS_OK : status, description);
}

// ---------------------------------------------------------------------------
// Exports: requests

/// respond(session, prompt, optionsJSON | null) → [Promise<{ status, text }>, request]
static napi_value LanguageModelSessionRespond(napi_env env, napi_callback_info info) {
  ARGS(3);
  PTR(argv[0], K_SESSION, false, session);
  PTR(argv[1], K_PROMPT, false, prompt);
  char *options;
  if (!get_string(env, argv[2], "optionsJSON", true, &options)) return NULL;
  napi_value promise;
  Request *r = request_start(env, R_TEXT, NULL, session, &promise);
  if (!r) {
    free(options);
    return NULL;
  }
  atomic_fetch_add(&r->refs, 1);  // the caller's, across the call
  const void *task = FMLanguageModelSessionRespond(session, prompt, options, r, on_response);
  free(options);
  request_set_task(r, task);
  return request_pair(env, promise, r);
}

static napi_value RespondStructured(napi_env env, napi_callback_info info, bool from_json) {
  ARGS(4);
  PTR(argv[0], K_SESSION, false, session);
  PTR(argv[1], K_PROMPT, false, prompt);
  const void *schema = NULL;
  char *schema_json = NULL;
  if (from_json) {
    if (!get_string(env, argv[2], "schemaJSON", false, &schema_json)) return NULL;
  } else {
    Handle *h;
    if (!get_handle(env, argv[2], K_SCHEMA, false, &h)) return NULL;
    schema = h->ptr;
  }
  char *options;
  if (!get_string(env, argv[3], "optionsJSON", true, &options)) {
    free(schema_json);
    return NULL;
  }
  napi_value promise;
  Request *r = request_start(env, R_STRUCTURED, NULL, session, &promise);
  if (!r) {
    free(schema_json);
    free(options);
    return NULL;
  }
  atomic_fetch_add(&r->refs, 1);
  const void *task =
      from_json
          ? FMLanguageModelSessionRespondWithSchemaFromJSON(session, prompt, schema_json, options,
                                                            r, on_structured)
          : FMLanguageModelSessionRespondWithSchema(session, prompt, schema, options, r,
                                                    on_structured);
  free(schema_json);
  free(options);
  request_set_task(r, task);
  return request_pair(env, promise, r);
}

/// respondWithSchema(session, prompt, schema, optionsJSON | null)
///   → [Promise<{ status, content, message }>, request]
static napi_value LanguageModelSessionRespondWithSchema(napi_env env, napi_callback_info info) {
  return RespondStructured(env, info, false);
}

/// Like LanguageModelSessionRespondWithSchema, with the schema as JSON.
static napi_value LanguageModelSessionRespondWithSchemaFromJSON(napi_env env,
                                                               napi_callback_info info) {
  return RespondStructured(env, info, true);
}

/// streamResponse(session, prompt, optionsJSON | null, onChunk(status, text | null))
///   → request, or null if the bridge couldn't start the stream
static napi_value LanguageModelSessionStreamResponse(napi_env env, napi_callback_info info) {
  ARGS(4);
  PTR(argv[0], K_SESSION, false, session);
  PTR(argv[1], K_PROMPT, false, prompt);
  napi_valuetype callback_type = napi_undefined;
  napi_typeof(env, argv[3], &callback_type);
  if (callback_type != napi_function) {
    napi_throw_type_error(env, NULL, "Expected a function for \"onChunk\"");
    return NULL;
  }
  char *options;
  if (!get_string(env, argv[2], "optionsJSON", true, &options)) return NULL;
  FMLanguageModelSessionResponseStreamRef stream =
      FMLanguageModelSessionStreamResponse(session, prompt, options);
  free(options);
  if (!stream) return js_null(env);
  Request *r = request_start(env, R_STREAM, argv[3], session, NULL);
  if (!r) {
    FMRelease(stream);
    return NULL;
  }
  r->stream = stream;
  napi_value handle = request_handle(env, r);
  if (!handle) {
    // Never iterated, so no final call will come: end the request here, which
    // releases the stream, the function and the native side's reference.
    request_deliver(r, NULL, true);
    return NULL;
  }
  FMLanguageModelSessionResponseStreamIterate(stream, r, on_response);
  return handle;
}

/// Cancels a request: a stream is released (its task ends with a final
/// "cancelled" call); a one-shot request's task is cancelled.
static napi_value RequestCancel(napi_env env, napi_callback_info info) {
  ARGS(1);
  Handle *h;
  if (!get_handle(env, argv[0], K_REQUEST, false, &h)) return NULL;
  Request *r = h->req;
  if (!r) return js_undefined(env);
  if (r->kind == R_STREAM) {
    release_stream_once(r);
    return js_undefined(env);
  }
  pthread_mutex_lock(&g_lock);
  const void *task = r->finished ? NULL : r->task;
  if (task) FMRetain(task);
  pthread_mutex_unlock(&g_lock);
  if (task) {
    FMTaskCancel(task);
    FMRelease(task);
  }
  return js_undefined(env);
}

static napi_value start_count(napi_env env, const void *retained,
                              const void *(*call)(Request *, void *), void *arg) {
  napi_value promise;
  Request *r = request_start(env, R_COUNT, NULL, retained, &promise);
  if (!r) return NULL;
  atomic_fetch_add(&r->refs, 1);
  request_set_task(r, call(r, arg));
  return request_pair(env, promise, r);
}

/// Like start_count, but the native call reports text through on_response
/// (an R_TEXT request). Used for PCC's async supportedLanguages.
static napi_value start_text(napi_env env, const void *retained,
                             const void *(*call)(Request *, void *), void *arg) {
  napi_value promise;
  Request *r = request_start(env, R_TEXT, NULL, retained, &promise);
  if (!r) return NULL;
  atomic_fetch_add(&r->refs, 1);
  request_set_task(r, call(r, arg));
  return request_pair(env, promise, r);
}

typedef struct {
  const void *model;
  const void *object;
  const char *text;
  FMBridgedToolRef *tools;
  int count;
} CountArgs;

static const void *count_prompt(Request *r, void *a) {
  CountArgs *c = a;
  return FMSystemLanguageModelTokenCountForPrompt(c->model, c->object, r, on_count);
}
static const void *count_instructions(Request *r, void *a) {
  CountArgs *c = a;
  return FMSystemLanguageModelTokenCountForInstructions(c->model, c->text, r, on_count);
}
static const void *count_tools(Request *r, void *a) {
  CountArgs *c = a;
  return FMSystemLanguageModelTokenCountForTools(c->model, c->tools, c->count, r, on_count);
}
static const void *count_schema(Request *r, void *a) {
  CountArgs *c = a;
  return FMSystemLanguageModelTokenCountForSchema(c->model, c->object, r, on_count);
}
static const void *count_transcript(Request *r, void *a) {
  CountArgs *c = a;
  return FMSystemLanguageModelTokenCountForTranscript(c->model, c->object, r, on_count);
}
static const void *count_pcc_context(Request *r, void *a) {
  CountArgs *c = a;
  return FMPrivateCloudComputeLanguageModelGetContextSize((void *)c->model, r, on_count);
}
static const void *count_pcc_locale(Request *r, void *a) {
  CountArgs *c = a;
  return FMPrivateCloudComputeLanguageModelSupportsLocale((void *)c->model, c->text, r, on_count);
}
static const void *text_pcc_languages(Request *r, void *a) {
  CountArgs *c = a;
  return FMPrivateCloudComputeLanguageModelGetSupportedLanguages((void *)c->model, r, on_response);
}

// Token counts: (model, input) → [Promise<{ status, count, message }>, request]

static napi_value SystemLanguageModelTokenCountForPrompt(napi_env env, napi_callback_info info) {
  ARGS(2);
  PTR(argv[0], K_MODEL, false, model);
  PTR(argv[1], K_PROMPT, false, prompt);
  CountArgs args = {.model = model, .object = prompt};
  return start_count(env, model, count_prompt, &args);
}

static napi_value SystemLanguageModelTokenCountForInstructions(napi_env env,
                                                              napi_callback_info info) {
  ARGS(2);
  PTR(argv[0], K_MODEL, false, model);
  char *text;
  if (!get_string(env, argv[1], "instructions", false, &text)) return NULL;
  CountArgs args = {.model = model, .text = text};
  napi_value result = start_count(env, model, count_instructions, &args);
  free(text);
  return result;
}

static napi_value SystemLanguageModelTokenCountForTools(napi_env env, napi_callback_info info) {
  ARGS(2);
  CountArgs args = {0};
  if (!get_tools(env, argv[1], &args.tools, &args.count)) return NULL;
  Handle *model;
  if (!get_handle(env, argv[0], K_MODEL, false, &model)) {
    free(args.tools);
    return NULL;
  }
  args.model = model->ptr;
  napi_value result = start_count(env, args.model, count_tools, &args);
  free(args.tools);
  return result;
}

static napi_value SystemLanguageModelTokenCountForSchema(napi_env env, napi_callback_info info) {
  ARGS(2);
  PTR(argv[0], K_MODEL, false, model);
  PTR(argv[1], K_SCHEMA, false, schema);
  CountArgs args = {.model = model, .object = schema};
  return start_count(env, model, count_schema, &args);
}

static napi_value SystemLanguageModelTokenCountForTranscript(napi_env env,
                                                            napi_callback_info info) {
  ARGS(2);
  PTR(argv[0], K_MODEL, false, model);
  PTR(argv[1], K_SESSION, false, transcript);
  CountArgs args = {.model = model, .object = transcript};
  return start_count(env, model, count_transcript, &args);
}

static napi_value PrivateCloudComputeLanguageModelGetContextSize(napi_env env,
                                                                napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_PCC, false, model);
  CountArgs args = {.model = model};
  return start_count(env, model, count_pcc_context, &args);
}

// PCC's supportedLanguages is async, so it's a text request: [Promise<{ status,
// text }>, request], the text being a JSON array of locale identifiers.
static napi_value PrivateCloudComputeLanguageModelGetSupportedLanguages(napi_env env,
                                                                        napi_callback_info info) {
  ARGS(1);
  PTR(argv[0], K_PCC, false, model);
  CountArgs args = {.model = model};
  return start_text(env, model, text_pcc_languages, &args);
}

// PCC's supportsLocale is async: [Promise<{ status, count, message }>, request],
// count 1 for supported, 0 for not.
static napi_value PrivateCloudComputeLanguageModelSupportsLocale(napi_env env,
                                                                napi_callback_info info) {
  ARGS(2);
  PTR(argv[0], K_PCC, false, model);
  char *locale;
  if (!get_string(env, argv[1], "localeIdentifier", false, &locale)) return NULL;
  CountArgs args = {.model = model, .text = locale};
  napi_value result = start_count(env, model, count_pcc_locale, &args);
  free(locale);
  return result;
}

// ---------------------------------------------------------------------------
// Exports: tools

/// BridgedToolCreate(name, description, schema, onCall(content, callId))
///   → { value: tool | null, status, description }
static napi_value BridgedToolCreate(napi_env env, napi_callback_info info) {
  ARGS(4);
  char *name, *description;
  if (!get_string(env, argv[0], "name", false, &name)) return NULL;
  if (!get_string(env, argv[1], "description", false, &description)) {
    free(name);
    return NULL;
  }
  Handle *schema;
  if (!get_handle(env, argv[2], K_SCHEMA, false, &schema)) {
    free(name);
    free(description);
    return NULL;
  }
  napi_valuetype callback_type = napi_undefined;
  napi_typeof(env, argv[3], &callback_type);
  if (callback_type != napi_function) {
    napi_throw_type_error(env, NULL, "Expected a function for \"onCall\"");
    free(name);
    free(description);
    return NULL;
  }

  ToolBox *b = calloc(1, sizeof(ToolBox));
  if (!b) {
    free(name);
    free(description);
    napi_throw_error(env, NULL, "tsfm: out of memory");
    return NULL;
  }
  atomic_init(&b->refs, 2);  // Swift + threadsafe function
  napi_value resource;
  napi_create_string_utf8(env, "tsfm tool", NAPI_AUTO_LENGTH, &resource);
  if (napi_create_threadsafe_function(env, argv[3], NULL, resource, 0, 1, b, tool_tsfn_finalize, b,
                                      tool_call_js, &b->tsfn) != napi_ok) {
    free(b);
    free(name);
    free(description);
    throw_last_error(env, "creating a threadsafe function");
    return NULL;
  }
  // A tool shouldn't keep the process alive; its requests do.
  napi_unref_threadsafe_function(env, b->tsfn);
  napi_add_env_cleanup_hook(env, tool_env_teardown, b);
  b->hook_registered = true;

  int status = STATUS_OK;
  char *error_description = NULL;
  FMBridgedToolRef tool = FMBridgedToolCreateWithUserInfo(
      name, description, schema->ptr, on_tool_call, b, on_tool_freed, &status, &error_description);
  free(name);
  free(description);
  if (!tool) {
    // Swift never took its reference; drop it and the function.
    pthread_mutex_lock(&g_lock);
    if (b->tsfn) napi_release_threadsafe_function(b->tsfn, napi_tsfn_abort);
    b->tsfn = NULL;
    pthread_mutex_unlock(&g_lock);
    tool_unref(b);
    return make_result(env, js_null(env), status, error_description);
  }

  EnvState *state = env_state(env);
  pthread_mutex_lock(&g_lock);
  b->tool = tool;
  if (!state || state->shutdown) {
    if (b->tsfn) napi_release_threadsafe_function(b->tsfn, napi_tsfn_abort);
    b->tsfn = NULL;
  } else {
    tool_list_add(state, b);
  }
  pthread_mutex_unlock(&g_lock);

  napi_value handle = make_handle(env, K_TOOL, tool);
  if (!handle) return NULL;  // make_handle released the tool
  Handle *h;
  napi_get_value_external(env, handle, (void **)&h);
  h->tool = b;
  return make_result(env, handle, STATUS_OK, NULL);
}

static napi_value finish_call(napi_env env, napi_callback_info info, bool fail) {
  ARGS(4);
  Handle *h;
  if (!get_handle(env, argv[0], K_TOOL, false, &h)) return NULL;
  uint32_t id;
  if (napi_get_value_uint32(env, argv[1], &id) != napi_ok) {
    napi_throw_type_error(env, NULL, "Expected a call id");
    return NULL;
  }
  int32_t code = STATUS_UNKNOWN;
  if (fail && !get_int(env, argv[2], "code", &code)) return NULL;
  char *text;
  if (!get_string(env, argv[fail ? 3 : 2], fail ? "message" : "output", false, &text)) return NULL;
  ToolBox *b = h->tool;
  pthread_mutex_lock(&g_lock);
  bool was_pending = b ? take_pending(b, id) : false;
  pthread_mutex_unlock(&g_lock);
  // Answering a call that isn't pending (answered, failed on release, or never
  // made) would find no continuation anyway; skip it.
  if (was_pending) {
    if (fail) FMBridgedToolFailCall(h->ptr, id, code, text);
    else FMBridgedToolFinishCall(h->ptr, id, text);
  }
  free(text);
  return js_bool(env, was_pending);
}

/// BridgedToolFinishCall(tool, callId, output) → whether the call was pending
static napi_value BridgedToolFinishCall(napi_env env, napi_callback_info info) {
  return finish_call(env, info, false);
}

/// BridgedToolFailCall(tool, callId, code, message) → whether the call was pending
static napi_value BridgedToolFailCall(napi_env env, napi_callback_info info) {
  return finish_call(env, info, true);
}

// ---------------------------------------------------------------------------
// Exports: lifetime

/// Release(handle): drops JavaScript's reference to the native object. Safe to
/// call more than once; later uses of the handle throw.
static napi_value Release(napi_env env, napi_callback_info info) {
  ARGS(1);
  if (is_nullish(env, argv[0])) return js_undefined(env);
  napi_valuetype t;
  bool tagged = false;
  if (napi_typeof(env, argv[0], &t) != napi_ok || t != napi_external ||
      napi_check_object_type_tag(env, argv[0], &HANDLE_TAG, &tagged) != napi_ok || !tagged) {
    napi_throw_type_error(env, NULL, "Expected a tsfm handle");
    return NULL;
  }
  Handle *h;
  napi_get_value_external(env, argv[0], (void **)&h);
  release_handle(h);
  return js_undefined(env);
}

/// Shutdown(): called on process "exit", which skips Node-API's env cleanup
/// hooks. Cuts every request and tool off from JavaScript; native callbacks
/// after this are absorbed (tool calls fail).
static napi_value Shutdown(napi_env env, napi_callback_info info) {
  (void)info;
  EnvState *state = env_state(env);
  if (!state) return js_undefined(env);
  pthread_mutex_lock(&g_lock);
  state->shutdown = true;
  while (state->requests) {
    Request *r = state->requests;
    if (r->tsfn) napi_release_threadsafe_function(r->tsfn, napi_tsfn_abort);
    r->tsfn = NULL;
    request_list_remove(r);
  }
  while (state->tools) {
    ToolBox *b = state->tools;
    if (b->tsfn) napi_release_threadsafe_function(b->tsfn, napi_tsfn_abort);
    b->tsfn = NULL;
    tool_list_remove(b);
  }
  pthread_mutex_unlock(&g_lock);
  return js_undefined(env);
}

/// The env is gone: detach anything still listed, so no later list update
/// reaches the freed state.
static void env_state_finalize(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  EnvState *state = data;
  pthread_mutex_lock(&g_lock);
  while (state->requests) request_list_remove(state->requests);
  while (state->tools) tool_list_remove(state->tools);
  pthread_mutex_unlock(&g_lock);
  free(state);
}

// ---------------------------------------------------------------------------

// Writable and configurable like ordinary properties, so tests can spy on them.
#define EXPORT(name) {"FM" #name, NULL, name, NULL, NULL, NULL, napi_default_jsproperty, NULL}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  if (!env_state(env)) {
    EnvState *state = calloc(1, sizeof(EnvState));
    if (!state || napi_set_instance_data(env, state, env_state_finalize, NULL) != napi_ok) {
      free(state);
      napi_throw_error(env, NULL, "tsfm: couldn't set up the addon");
      return NULL;
    }
  }
  napi_property_descriptor props[] = {
      EXPORT(SystemLanguageModelCreate),
      EXPORT(SystemLanguageModelIsAvailable),
      EXPORT(SystemLanguageModelGetContextSize),
      EXPORT(SystemLanguageModelGetVariantName),
      EXPORT(SystemLanguageModelGetCapabilitiesJSON),
      EXPORT(SystemLanguageModelGetSupportedLanguages),
      EXPORT(SystemLanguageModelSupportsLocale),
      EXPORT(SystemLanguageModelTokenCountForPrompt),
      EXPORT(SystemLanguageModelTokenCountForInstructions),
      EXPORT(SystemLanguageModelTokenCountForTools),
      EXPORT(SystemLanguageModelTokenCountForSchema),
      EXPORT(SystemLanguageModelTokenCountForTranscript),
      EXPORT(PrivateCloudComputeLanguageModelCreate),
      EXPORT(PrivateCloudComputeLanguageModelIsAvailable),
      EXPORT(PrivateCloudComputeLanguageModelGetCapabilitiesJSON),
      EXPORT(PrivateCloudComputeLanguageModelGetQuotaUsageJSON),
      EXPORT(PrivateCloudComputeLanguageModelGetSupportedLanguages),
      EXPORT(PrivateCloudComputeLanguageModelSupportsLocale),
      EXPORT(PrivateCloudComputeLanguageModelGetContextSize),
      EXPORT(LanguageModelSessionCreateFromSystemLanguageModel),
      EXPORT(LanguageModelSessionCreateFromPrivateCloudComputeModel),
      EXPORT(LanguageModelSessionCreateFromTranscript),
      EXPORT(LanguageModelSessionCreateFromTranscriptWithPrivateCloudComputeModel),
      EXPORT(LanguageModelSessionIsResponding),
      EXPORT(LanguageModelSessionReset),
      EXPORT(LanguageModelSessionPrewarm),
      EXPORT(LanguageModelSessionGetUsageJSON),
      EXPORT(LanguageModelSessionGetTranscriptJSONString),
      EXPORT(LanguageModelSessionRespond),
      EXPORT(LanguageModelSessionRespondWithSchema),
      EXPORT(LanguageModelSessionRespondWithSchemaFromJSON),
      EXPORT(LanguageModelSessionStreamResponse),
      EXPORT(TranscriptCreateFromJSONString),
      EXPORT(ComposedPromptInitialize),
      EXPORT(ComposedPromptAddText),
      EXPORT(ComposedPromptAddAttachment),
      EXPORT(GenerationSchemaCreate),
      EXPORT(GenerationSchemaPropertyCreate),
      EXPORT(GenerationSchemaAddProperty),
      EXPORT(GenerationSchemaAddReferenceSchema),
      EXPORT(GenerationSchemaGetJSONString),
      {"FMGenerationSchemaPropertyAddAnyOfGuide", NULL, PropertyAddAnyOfGuide, NULL, NULL, NULL,
       napi_default_jsproperty, NULL},
      {"FMGenerationSchemaPropertyAddCountGuide", NULL, PropertyAddCountGuide, NULL, NULL, NULL,
       napi_default_jsproperty, NULL},
      {"FMGenerationSchemaPropertyAddMaxItemsGuide", NULL, PropertyAddMaxItemsGuide, NULL, NULL,
       NULL, napi_default_jsproperty, NULL},
      {"FMGenerationSchemaPropertyAddMinItemsGuide", NULL, PropertyAddMinItemsGuide, NULL, NULL,
       NULL, napi_default_jsproperty, NULL},
      {"FMGenerationSchemaPropertyAddMaximumGuide", NULL, PropertyAddMaximumGuide, NULL, NULL, NULL,
       napi_default_jsproperty, NULL},
      {"FMGenerationSchemaPropertyAddMinimumGuide", NULL, PropertyAddMinimumGuide, NULL, NULL, NULL,
       napi_default_jsproperty, NULL},
      {"FMGenerationSchemaPropertyAddRangeGuide", NULL, PropertyAddRangeGuide, NULL, NULL, NULL,
       napi_default_jsproperty, NULL},
      {"FMGenerationSchemaPropertyAddRegex", NULL, PropertyAddRegex, NULL, NULL, NULL,
       napi_default_jsproperty, NULL},
      EXPORT(GeneratedContentCreateFromJSON),
      EXPORT(GeneratedContentIsComplete),
      EXPORT(GeneratedContentGetJSONString),
      EXPORT(GeneratedContentGetPropertyValue),
      EXPORT(BridgedToolCreate),
      EXPORT(BridgedToolFinishCall),
      EXPORT(BridgedToolFailCall),
      EXPORT(RequestCancel),
      EXPORT(Release),
      EXPORT(Shutdown),
  };
  napi_define_properties(env, exports, sizeof props / sizeof *props, props);
  return exports;
}
