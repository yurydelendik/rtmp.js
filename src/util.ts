/*
 * Copyright 2015 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// parts and shims of the Mozilla Shumway project to run amf.js logic

///<reference path='references.ts' />

/** @const */ var release: boolean = false;

// TODO no way around it, we need to refactor amf.js to make it easier
Object.defineProperty(Object.prototype, 'asSetPublicProperty', {
  value: function (name, value) {
    this[name] = value;
  }
});

module Shumway {
  export function isNumeric(a) {
    return +a == a;
  }
}

module Shumway.AVM2.Runtime {
  export function construct(cls, args): any {
    return {};
  }

  export function forEachPublicProperty(obj, fn, thisArg = null) {
    for (var i in obj) {
      fn.call(thisArg, i, obj[i]);
    }
  }
}

module Shumway.AVM2.ABC {
  export var Multiname = {
    getQualifiedName: function (name) {
      return name;
    },
    getPublicQualifiedName: function (name) {
      return name;
    }
  };
}

module Shumway.AVM2.AS.flash.net {
  export class ObjectEncoding {
    public static AMF0 = 0;
    public static AMF3 = 3;
    public static DEFAULT = ObjectEncoding.AMF3;
  }
}

module Shumway.AVM2.AS.flash.utils {
  export class ByteArray {
    constructor(a?) {
      return <any>buildByteArray(a);
    }
    public length: number;
    public position: number;
    public objectEncoding: number;
    public readByte: () => number;
    public writeByte: (v: number) => void;
    public readObject: () => any;
    public writeObject: (obj: any) => void;
  }

  function buildByteArray(a?) {
    var result: any = [];
    if (a) {
      for (var i = 0; i < a.length; i++) result[i] = a[i];
    }
    Object.defineProperties(result, {
      position: { value: 0, writable: true },
      objectEncoding: { value: 3, writable: true },
      readByte: { value: function () {
        if (result.position >= result.length) throw 'EOF';
        return result[result.position++];
      }
      },
      writeByte: { value: function (v) {
        result[result.position++] = v & 0xFF;
      }
      },
      readObject: { value: function () {
        switch (this.objectEncoding) {
          case flash.net.ObjectEncoding.AMF0:
            return AMF0.read(this);
          case flash.net.ObjectEncoding.AMF3:
            return AMF3.read(this);
          default:
            throw new Error("Object Encoding");
        }
      }
      },
      writeObject: { value: function (object) {
        switch (this.objectEncoding) {
          case flash.net.ObjectEncoding.AMF0:
            return AMF0.write(this, object);
          case flash.net.ObjectEncoding.AMF3:
            return AMF3.write(this, object);
          default:
            throw new Error("Object Encoding");
        }
      }
      }
    });
    return result;
  }
}

module Shumway.StringUtilities {
  export function utf8decode(str: string) {
    var bytes = new Uint8Array(str.length * 4);
    var b = 0;
    for (var i = 0, j = str.length; i < j; i++) {
      var code = str.charCodeAt(i);
      if (code <= 0x7f) {
        bytes[b++] = code;
        continue;
      }

      if (0xD800 <= code && code <= 0xDBFF) {
        var codeLow = str.charCodeAt(i + 1);
        if (0xDC00 <= codeLow && codeLow <= 0xDFFF) {
          // convert only when both high and low surrogates are present
          code = ((code & 0x3FF) << 10) + (codeLow & 0x3FF) + 0x10000;
          ++i;
        }
      }

      if ((code & 0xFFE00000) !== 0) {
        bytes[b++] = 0xF8 | ((code >>> 24) & 0x03);
        bytes[b++] = 0x80 | ((code >>> 18) & 0x3F);
        bytes[b++] = 0x80 | ((code >>> 12) & 0x3F);
        bytes[b++] = 0x80 | ((code >>> 6) & 0x3F);
        bytes[b++] = 0x80 | (code & 0x3F);
      } else if ((code & 0xFFFF0000) !== 0) {
        bytes[b++] = 0xF0 | ((code >>> 18) & 0x07);
        bytes[b++] = 0x80 | ((code >>> 12) & 0x3F);
        bytes[b++] = 0x80 | ((code >>> 6) & 0x3F);
        bytes[b++] = 0x80 | (code & 0x3F);
      } else if ((code & 0xFFFFF800) !== 0) {
        bytes[b++] = 0xE0 | ((code >>> 12) & 0x0F);
        bytes[b++] = 0x80 | ((code >>> 6) & 0x3F);
        bytes[b++] = 0x80 | (code & 0x3F);
      } else {
        bytes[b++] = 0xC0 | ((code >>> 6) & 0x1F);
        bytes[b++] = 0x80 | (code & 0x3F);
      }
    }
    return bytes.subarray(0, b);
  }

  export function utf8encode(bytes): string {
    var j = 0, str = "";
    while (j < bytes.length) {
      var b1 = bytes[j++] & 0xFF;
      if (b1 <= 0x7F) {
        str += String.fromCharCode(b1);
      } else {
        var currentPrefix = 0xC0;
        var validBits = 5;
        do {
          var mask = (currentPrefix >> 1) | 0x80;
          if ((b1 & mask) === currentPrefix) break;
          currentPrefix = (currentPrefix >> 1) | 0x80;
          --validBits;
        } while (validBits >= 0);

        if (validBits <= 0) {
          throw "Invalid UTF8 character";
        }
        var code = (b1 & ((1 << validBits) - 1));
        for (var i = 5; i >= validBits; --i) {
          var bi = bytes[j++];
          if ((bi & 0xC0) != 0x80) {
            throw "Invalid UTF8 character sequence";
          }
          code = (code << 6) | (bi & 0x3F);
        }

        if (code >= 0x10000) {
          str += String.fromCharCode((((code - 0x10000) >> 10) & 0x3FF) |
            0xD800, (code & 0x3FF) | 0xDC00);
        } else {
          str += String.fromCharCode(code);
        }
      }
    }
    return str;
  }
}
