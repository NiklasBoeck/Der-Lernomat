// Adresse des gemeinsamen KI-Zugangs (Cloudflare Worker). Leer = jede Person braucht einen eigenen API-Schlüssel.
export const SHARED_AI_URL = 'https://lernomat-ki.viklas-boeck.workers.dev';
// Cloud-KI (Claude über API-Schlüssel oder gemeinsamen Zugang) ist vorerst abgeschaltet.
// Stattdessen arbeitet Nomi, der Lernassistent direkt auf dem Gerät. Auf true setzen, um die Cloud-KI zurückzuholen.
export const CLOUD_AI = false;
