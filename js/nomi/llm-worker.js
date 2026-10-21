// Läuft im Hintergrund: das Sprachmodell rechnet hier, damit die App flüssig bleibt.
import { WebWorkerMLCEngineHandler } from '../vendor/web-llm-0.2.86.min.js';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = msg => handler.onmessage(msg);
