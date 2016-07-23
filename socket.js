var crypto = require("crypto")
   ,http = require("http");

http.createServer(function (req, res) {
   res.write("sfs");
   res.end("sdf");
}).listen(8080);
