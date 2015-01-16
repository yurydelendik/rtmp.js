/*
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
module.exports = function(grunt) {
  var tsCommonArguments = 'tsc --target ES5 --removeComments --sourcemap -d --out build/ts/';

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    jshint: {
      options: {
        jshintrc: 'test/jshint_config.json'
      },
      all: ['src/flash/**/*.js', 'src/swf/*.js']
    },
    tslint: {
      options: {
        configuration: grunt.file.readJSON("tslint.json")
      },
      all: ['src/**/*.ts']
    },
    exec: {
      build_src_ts: {
        cmd: tsCommonArguments + 'rtmp.js src/references.ts'
      },
      build_src_node_ts: {
        cmd: tsCommonArguments + 'rtmp-node.js src/references-node.ts'
      }
    }
  });

  grunt.loadNpmTasks('grunt-tslint');
  grunt.loadNpmTasks('grunt-exec');

  grunt.registerTask('ensureBuildDirectory', function () {
    grunt.file.mkdir('build');
  });

  grunt.registerTask('build', ['ensureBuildDirectory', 'exec:build_src_ts', 'exec:build_src_node_ts']);

  grunt.registerTask('test', ['tslint:all']);
};