var threadInfoStruct = 0;
var selfThreadId = 0;
var parentThreadId = 0;
var Module = {};

function assert(condition, text) {
  if (!condition) abort("Assertion failed: " + text)
}

function threadPrintErr() {
  var text = Array.prototype.slice.call(arguments).join(" ");
  console.error(text)
}

function threadAlert() {
  var text = Array.prototype.slice.call(arguments).join(" ");
  postMessage({
    cmd: "alert",
    text: text,
    threadId: selfThreadId
  })
}
var out = function () {
  throw "out() is not defined in worker.js."
};
var err = threadPrintErr;
this.alert = threadAlert;
Module["instantiateWasm"] = function (info, receiveInstance) {
  var instance = new WebAssembly.Instance(Module["wasmModule"], info);
  Module["wasmModule"] = null;
  receiveInstance(instance);
  return instance.exports
};
this.onmessage = function (e) {
  try {
    if (e.data.cmd === "load") {
      console.log("LOADING YAY");
      console.log(e.data.urlOrBlob);
      Module["DYNAMIC_BASE"] = e.data.DYNAMIC_BASE;
      Module["DYNAMICTOP_PTR"] = e.data.DYNAMICTOP_PTR;
      Module["wasmModule"] = e.data.wasmModule;
      Module["wasmMemory"] = e.data.wasmMemory;
      Module["buffer"] = Module["wasmMemory"].buffer;
      Module["ENVIRONMENT_IS_PTHREAD"] = true;
      console.log("ABOUT TO LOAD");
      if (typeof e.data.urlOrBlob === "string") {
        console.log("IMPORT SCRIPTS?");
        importScripts(e.data.urlOrBlob)
        console.log("done importing");
      } else {
        var objectUrl = URL.createObjectURL(e.data.urlOrBlob);
        importScripts(objectUrl);
        URL.revokeObjectURL(objectUrl)
      }
      console.log("WORKER HAS INSTANTIATED");
      console.log(WasmBackendModule);
      Module = WasmBackendModule(Module);
      postMessage({
        "cmd": "loaded"
      })
    } else if (e.data.cmd === "objectTransfer") {
      Module["PThread"].receiveObjectTransfer(e.data)
    } else if (e.data.cmd === "run") {
      Module["__performance_now_clock_drift"] = performance.now() - e.data.time;
      threadInfoStruct = e.data.threadInfoStruct;
      Module["__register_pthread_ptr"](threadInfoStruct, 0, 0);
      selfThreadId = e.data.selfThreadId;
      parentThreadId = e.data.parentThreadId;
      var max = e.data.stackBase;
      var top = e.data.stackBase + e.data.stackSize;
      assert(threadInfoStruct);
      assert(selfThreadId);
      assert(parentThreadId);
      assert(top != 0);
      assert(max != 0);
      assert(top > max);
      Module["establishStackSpace"](top, max);
      Module["_emscripten_tls_init"]();
      Module["writeStackCookie"]();
      Module["PThread"].receiveObjectTransfer(e.data);
      Module["PThread"].setThreadStatus(Module["_pthread_self"](), 1);
      try {
        var result = Module["dynCall_ii"](e.data.start_routine, e.data.arg);
        Module["checkStackCookie"]();
        if (!Module["getNoExitRuntime"]()) Module["PThread"].threadExit(result)
      } catch (ex) {
        if (ex === "Canceled!") {
          Module["PThread"].threadCancel()
        } else if (ex != "unwind") {
          Atomics.store(Module["HEAPU32"], threadInfoStruct + 4 >> 2, ex instanceof Module["ExitStatus"] ? ex.status : -2);
          Atomics.store(Module["HEAPU32"], threadInfoStruct + 0 >> 2, 1);
          if (typeof Module["_emscripten_futex_wake"] !== "function") {
            err("Thread Initialisation failed.");
            throw ex
          }
          Module["_emscripten_futex_wake"](threadInfoStruct + 0, 2147483647);
          if (!(ex instanceof Module["ExitStatus"])) throw ex
        } else {
          err("Pthread 0x" + threadInfoStruct.toString(16) + " completed its pthread main entry point with an unwind, keeping the pthread worker alive for asynchronous operation.")
        }
      }
    } else if (e.data.cmd === "cancel") {
      if (threadInfoStruct) {
        Module["PThread"].threadCancel()
      }
    } else if (e.data.target === "setimmediate") {} else if (e.data.cmd === "processThreadQueue") {
      if (threadInfoStruct) {
        Module["_emscripten_current_thread_process_queued_calls"]()
      }
    } else {
      err("worker.js received unknown command " + e.data.cmd);
      err(e.data)
    }
  } catch (ex) {
    err("worker.js onmessage() captured an uncaught exception: " + ex);
    if (ex.stack) err(ex.stack);
    throw ex
  }
};
if (typeof process === "object" && typeof process.versions === "object" && typeof process.versions.node === "string") {
  self = {
    location: {
      href: __filename
    }
  };
  var onmessage = this.onmessage;
  var nodeWorkerThreads = require("worker_threads");
  Worker = nodeWorkerThreads.Worker;
  var parentPort = nodeWorkerThreads.parentPort;
  parentPort.on("message", function (data) {
    onmessage({
      data: data
    })
  });
  var nodeFS = require("fs");
  var nodeRead = function (filename) {
    return nodeFS.readFileSync(filename, "utf8")
  };

  function globalEval(x) {
    global.require = require;
    global.Module = Module;
    eval.call(null, x)
  }
  importScripts = function (f) {
    console.log('WORKER IMPORT SCRIPTS');
    console.log(f);
    globalEval(nodeRead(f))
  };
  postMessage = function (msg) {
    parentPort.postMessage(msg)
  };
  if (typeof performance === "undefined") {
    performance = {
      now: function () {
        return Date.now()
      }
    }
  }
}
