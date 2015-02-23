/**
 * Copyright 2015 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

module RtmpJs.MP3 {

  var BitratesMap = [
    32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448,
    32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384,
    32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
    32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256,
    8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

  var SamplingRateMap = [44100, 48000, 32000, 22050, 24000, 16000, 11025, 12000, 8000];

  export class MP3Parser {
    private buffer: Uint8Array;
    private bufferSize: number;

    public onNoise: (data: Uint8Array) => void;
    public onFrame: (data: Uint8Array) => void;
    public onClose: () => void;

    constructor() {
      this.buffer = null;
      this.bufferSize = 0;
    }

    public push(data: Uint8Array) {
      var length;
      if (this.bufferSize > 0) {
        var needBuffer = data.length + this.bufferSize;
        if (!this.buffer || this.buffer.length < needBuffer) {
          var newBuffer = new Uint8Array(needBuffer);
          if (this.bufferSize > 0) {
            newBuffer.set(this.buffer.subarray(0, this.bufferSize));
          }
          this.buffer = newBuffer;
        }
        this.buffer.set(data, this.bufferSize);
        this.bufferSize = needBuffer;
        data = this.buffer;
        length = needBuffer;
      } else {
        length = data.length;
      }

      var offset = 0;
      var parsed;
      while (offset < length &&
             (parsed = this._parse(data, offset, length)) > 0) {
        offset += parsed;
      }

      var tail = length - offset;
      if (tail > 0) {
        if (!this.buffer || this.buffer.length < tail) {
          this.buffer = new Uint8Array(data.subarray(offset, length));
        } else {
          this.buffer.set(data.subarray(offset, length));
        }
      }
      this.bufferSize = tail;
    }

    private _parse(data: Uint8Array, start: number, end: number): number  {
      if (start + 2 > end) {
        return -1; // we need at least 2 bytes to detect sync pattern
      }

      if (data[start] === 0xFF || (data[start + 1] & 0xE0) === 0xE0) {
        // Using http://www.datavoyage.com/mpgscript/mpeghdr.htm as a reference
        if (start + 24 > end) { // we need at least 24 bytes for full frame
          return -1;
        }
        var headerB = (data[start + 1] >> 3) & 3;
        var headerC = (data[start + 1] >> 1) & 3;
        var headerE = (data[start + 2] >> 4) & 15;
        var headerF = (data[start + 2] >> 2) & 3;
        var headerG = !!(data[start + 2] & 2);
        if (headerB !== 1 && headerE !== 0 && headerE !== 15 && headerF !== 3) {
          var columnInBitrates = headerB === 3 ? (3 - headerC) : (headerC === 3 ? 3 : 4);
          var bitRate = BitratesMap[columnInBitrates * 14 + headerE - 1] * 1000;
          var columnInSampleRates = headerB === 3 ? 0 : headerB === 2 ? 1 : 2;
          var sampleRate = SamplingRateMap[columnInSampleRates * 3 + headerF];
          var padding = headerG ? 1 : 0;
          var frameLength = headerC === 3 ?
            ((headerB === 3 ? 12 : 6) * bitRate / sampleRate + padding) << 2 :
            ((headerB === 3 ? 144 : 72) * bitRate / sampleRate + padding) | 0;
          if (start + frameLength > end) {
            return -1;
          }
          if (this.onFrame) {
            this.onFrame(data.subarray(start, start + frameLength));
          }
          return frameLength;
        }
      }

      // noise or ID3, trying to skip
      var offset = start + 2;
      while (offset < end) {
        if (data[offset - 1] === 0xFF && (data[offset] & 0xE0) === 0xE0) {
          // sync pattern is found
          if (this.onNoise) {
            this.onNoise(data.subarray(start, offset - 1));
          }
          return offset - start - 1;
        }
        offset++;
      }
      return -1;
    }

    public close() {
      if (this.bufferSize > 0) {
        if (this.onNoise) {
          this.onNoise(this.buffer.subarray(0, this.bufferSize));
        }
      }
      this.buffer = null;
      this.bufferSize = 0;

      if (this.onClose) {
        this.onClose();
      }
    }
  }
}
