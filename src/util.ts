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
module Shumway {
  export var RELEASE = false;

  export function isNumeric(a) {
    return +a == a;
  }

  export function setProperty(obj, name, value) {
    obj[name] = value;
  }

  export function forEachPublicProperty(obj, fn, thisArg) {
    for (var i in obj) {
      fn.call(thisArg, i, obj[i]);
    }
  }

  export var Multiname = {
    fromSimpleName: function (name) {
      return name;
    }
  };

  export function ByteArray(a?): void {
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
        return AMFUtils[this.objectEncoding].read(this);
      }
      },
      writeObject: { value: function (v) {
        AMFUtils[this.objectEncoding].write(this, v);
      }
      }
    });
    return result;
  }

  export function utf8decode(str) {
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

  export function utf8encode(bytes) {
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

// https://gist.github.com/958841
  function base64ArrayBuffer(arrayBuffer) {
    var base64 = '';
    var encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    var bytes = new Uint8Array(arrayBuffer);
    var byteLength = bytes.byteLength;
    var byteRemainder = byteLength % 3;
    var mainLength = byteLength - byteRemainder;

    var a, b, c, d;
    var chunk;

    // Main loop deals with bytes in chunks of 3
    for (var i = 0; i < mainLength; i = i + 3) {
      // Combine the three bytes into a single integer
      chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

      // Use bitmasks to extract 6-bit segments from the triplet
      a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
      b = (chunk & 258048) >> 12; // 258048 = (2^6 - 1) << 12
      c = (chunk & 4032) >> 6; // 4032 = (2^6 - 1) << 6
      d = chunk & 63; // 63 = 2^6 - 1

      // Convert the raw binary segments to the appropriate ASCII encoding
      base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
    }

    // Deal with the remaining bytes and padding
    if (byteRemainder == 1) {
      chunk = bytes[mainLength];

      a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

      // Set the 4 least significant bits to zero
      b = (chunk & 3) << 4; // 3 = 2^2 - 1

      base64 += encodings[a] + encodings[b] + '==';
    } else if (byteRemainder == 2) {
      chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

      a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
      b = (chunk & 1008) >> 4; // 1008 = (2^6 - 1) << 4

      // Set the 2 least significant bits to zero
      c = (chunk & 15) << 2; // 15 = 2^4 - 1

      base64 += encodings[a] + encodings[b] + encodings[c] + '=';
    }
    return base64;
  }
}
