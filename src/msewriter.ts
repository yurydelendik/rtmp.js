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

module RtmpJs {

  export interface IMediaDataSource {
    mimeType: string;
    onData: (data: Uint8Array) => void;
  }

  class MSEBufferWriter {
    mediaSource: MediaSource;
    dataSource: IMediaDataSource;
    sourceBuffer: SourceBuffer;
    sourceBufferUpdatedBound: (e) => void;
    updateEnabled: boolean;
    buffer: Uint8Array[];
    mimeType: string;

    constructor(mediaSource: MediaSource, dataSource: IMediaDataSource) {
      this.mediaSource = mediaSource;
      this.dataSource = dataSource;
      this.dataSource.onData = this.pushData.bind(this);
      this.updateEnabled = false;
      this.buffer = [];
      this.sourceBuffer = null;
      this.sourceBufferUpdatedBound = null;
    }

    allowWriting() {
      this.updateEnabled = true;
      this.update();
    }

    pushData(data: Uint8Array) {
      this.buffer.push(data);
      this.update();
    }

    update() {
      if (!this.updateEnabled || this.buffer.length === 0) {
        return;
      }

      if (!this.sourceBuffer) {
        this.sourceBuffer = this.mediaSource.addSourceBuffer(this.dataSource.mimeType);
        this.sourceBufferUpdatedBound = this._sourceBufferUpdated.bind(this);
        this.sourceBuffer.addEventListener('update', this.sourceBufferUpdatedBound);
      }

      this.updateEnabled = false;
      var data = this.buffer.shift();
      if (data === null) {
        // finish
        this.sourceBuffer.removeEventListener('update', this.sourceBufferUpdatedBound);
        return;
      }
      this.sourceBuffer.appendBuffer(<any>data);
    }

    private _sourceBufferUpdated(e) {
      this.updateEnabled = true;
      this.update();
    }

    finish() {
      this.buffer.push(null);
      this.update();
    }
  }

  export class MSEWriter {
    private mediaSource: MediaSource;
    private mediaSourceOpened: boolean;
    private bufferWriters: MSEBufferWriter[];

    constructor(mediaSource: MediaSource) {
      this.bufferWriters = [];
      this.mediaSource = mediaSource;
      this.mediaSourceOpened = false;
      this.mediaSource.addEventListener('sourceopen', function(e) {
        this.mediaSourceOpened = true;
        this.bufferWriters.forEach(function (writer) {
          writer.allowWriting();
        });
      }.bind(this));
      this.mediaSource.addEventListener('sourceend', function(e) {
        this.mediaSourceOpened = false;
      }.bind(this));
    }

    public listen(dataSource: IMediaDataSource) {
      var writer = new MSEBufferWriter(this.mediaSource, dataSource);
      this.bufferWriters.push(writer);
      if (this.mediaSourceOpened) {
        writer.allowWriting();
      }
    }
  }
}
