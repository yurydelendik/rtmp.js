# Real Time Message Protocol (RTMP) messaging library in JavaScript

Prototype implementation of the RTMP protocol. Based on the RTMP specification
at http://www.adobe.com/devnet/rtmp.html. Currently only Firefox in special
configuration is supported. The RTMP or RTMPT requires either TCP sockets or
unrestricted access to XHR. The Firefox (OS) provides both of those features:
TCPSocket or systemXHR.

Try running demo-rtmp.html in the browser and monitoring the traffic in the
web console. Use a local web server (e.g. python -m SimpleHTTPServer) for that.


## Setting up the desktop browser

The security reasons, the desktop browser disables access to the HTTP traffic
from the sites that are located in different domains. Also it has no means to
communicate over TCP protocol by default. The Firefox OS introduces the
following APIs:

- systemXHR (see mozSystem parameter for XMLHttpRequest at
  https://developer.mozilla.org/en-US/docs/DOM/XMLHttpRequest);
- TCPSocket API (see https://developer.mozilla.org/en-US/docs/DOM/TCPSocket)

To enable that for desktop, follow the instructions at
https://github.com/mozilla-b2g/gaia/blob/master/apps/email/README.md :

- Turn on mozTCPSocket -- in about:config, create "dom.mozTCPSocket.enabled";
- Grant permission for certain URL, e.g. evaluate in the error console:

```
host = 'http://localhost:8000';
perm = Components.classes["@mozilla.org/permissionmanager;1"]
                 .createInstance(Components.interfaces.nsIPermissionManager);
ios = Components.classes["@mozilla.org/network/io-service;1"]
                .getService(Components.interfaces.nsIIOService);
uri = ios.newURI(host, null, null);
perm.add(uri, 'systemXHR', 1);
perm.add(uri, 'tcp-socket', 1);
'Successfully added systemXHR and tcp-socket permissions for '+host;
```

## Setting up RTMP server

The Red5 server (http://www.red5.org/) is used for testing. Its download can be
found at http://red5.org/downloads/red5/1_0/red5-1.0.0.tar.gz. Navigate to
http://localhost:5080/installer/ at install the "OFLA Demo" application.

