// REPLACE THE ENTIRE CONTENTS OF: session.js

import { log } from './utils/debug.js';

// This file is now intentionally minimal. The responsibility for remembering
// a user's plans has been moved to a server-side lookup in api.js.
// Local storage is no longer the source of truth for the "My Plans" list.
