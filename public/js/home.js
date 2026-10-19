import { init, toast } from './auth.js';
init().catch(error => toast(error.message, true));
