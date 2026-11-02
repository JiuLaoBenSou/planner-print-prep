/// <reference lib="webworker" />
import {zipFiles} from './plus-core';
self.onmessage=event=>{try{const bytes=zipFiles(event.data);self.postMessage({bytes},[bytes.buffer]);}catch(error){self.postMessage({error:error instanceof Error?error.message:'Could not package output.'});}};
