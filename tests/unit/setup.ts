// Unit tests describe macOS 27 behavior unless a test says otherwise, whatever
// Mac (or Linux runner) they run on. tests/unit/macos26.test.ts switches to 26.
import { _setRuntimeMacOSMajorForTesting } from "../../src/os.js";

_setRuntimeMacOSMajorForTesting(27);
