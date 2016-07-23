var http = require('http');
var url = require('url');
// var mime = require('mime');
var crypto = require('crypto');
var pool=[];
var key = "";

var port = 8080;
var server = http.createServer();
    server.listen(port,function() {
        console.log('server is running on localhost:',port);
        server
        .on('connection',function(s) {
            console.log('on connection ');
        })
        .on('request',onrequest)
        .on('upgrade',onupgrade);
    });

var onrequest = function(req,res) {
    //console.log( Object.keys(req) ,req.url,req['upgrade']);
    if( !req.upgrade ){
        // 非upgrade请求选择：中断或提供普通网页
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write( 'WebSocket server works!' );
        
    }
    res.end();
    return;
};

var onupgrade = function (req,sock,head) {
    // console.log('方法:',Object.keys(sock));
	console.log(req.headers.origin);
    if(req.headers.upgrade !== 'websocket'){
        console.warn('非法连接');
        sock.end();
        return;
    }
    

	pool.push(sock);
    	bind_sock_event(sock);
    try{
        key = handshake(req,sock,head);
    }catch(e){
        console.error(e);
        sock.end();
    }
};

// 包装将要发送的帧
var wrap = function(data) {
    var fa = 0x00, fe = 0xff, data = data.toString()
        len = 2+Buffer.byteLength(data),
        buff = new Buffer(len);

    buff[0] = fa;
    buff.write(data,1);
    buff[len-1] = fe;
    return buff;
}
// 解开接收到的帧
var unwrap = function(data) {
    return data.slice(1,data.length-1);
}
function encodeDataFrame(e){
  var s=[],o=new Buffer(e.PayloadData),l=o.length;
  //输入第一个字节
  s.push((e.FIN<<7)+e.Opcode);
  //输入第二个字节，判断它的长度并放入相应的后续长度消息
  //永远不使用掩码
  if(l<126)s.push(l);
  else if(l<0x10000)s.push(126,(l&0xFF00)>>8,l&0xFF);
  else s.push(
    127, 0,0,0,0, //8字节数据，前4字节一般没用留空
    (l&0xFF000000)>>24,(l&0xFF0000)>>16,(l&0xFF00)>>8,l&0xFF
  );
  //返回头部分和数据部分的合并缓冲区
  return Buffer.concat([new Buffer(s),o]);
};

function decodeDataFrame(e){
  var i=0,j,s,frame={
    //解析前两个字节的基本数据
    FIN:e[i]>>7,Opcode:e[i++]&15,Mask:e[i]>>7,
    PayloadLength:e[i++]&0x7F
  };
  //处理特殊长度126和127
  if(frame.PayloadLength==126)
    frame.PayloadLength=(e[i++]<<8)+e[i++];
  if(frame.PayloadLength==127)
    i+=4, //长度一般用四字节的整型，前四个字节通常为长整形留空的
    frame.PayloadLength=(e[i++]<<24)+(e[i++]<<16)+(e[i++]<<8)+e[i++];
  //判断是否使用掩码
  if(frame.Mask){
    //获取掩码实体
    frame.MaskingKey=[e[i++],e[i++],e[i++],e[i++]];
    //对数据和掩码做异或运算
    for(j=0,s=[];j<frame.PayloadLength;j++)
      s.push(e[i+j]^frame.MaskingKey[j%4]);
  }else s=e.slice(i,frame.PayloadLength); //否则直接使用数据
  //数组转换成缓冲区来使用
  s=new Buffer(s);
  //如果有必要则把缓冲区转换成字符串来使用
  if(frame.Opcode==1)s=s.toString();
  //设置上数据部分
  frame.PayloadData=s;
  //返回数据帧
  return frame;
};
var bind_sock_event = function(sock) {
    sock
    .on('data',function(buffer_) {
        //var data = unwrap(buffer);
	var data;
	data = buffer;
	//console.log('socket receive data : ', buffer, data.toString());
        //send('hello html5,'+Date.now())
	//data = unwrap(buffer);
        //sock.emit('send',data);

     var frame=decodeDataFrame(buffer_);
      //文本帧
      if(frame.Opcode==1){
        //转义数据
        var content=frame.PayloadData.replace(/\W/g,function(e){
          e=e.charCodeAt(0).toString(16);
          if(e.length==3)e='0'+e;
          return '\\'+(e.length>2?'u':'x')+e;
        }),client=sock.remoteAddress+":"+sock.remotePort,buffer;
        //包装成JSON格式，并做成一个数据帧
        buffer=encodeDataFrame({
          FIN:1,Opcode:1,
          PayloadData:'{"client":"'+client+'","content":"'+content+'"}'
        });
        //对所有连接广播数据
	
        for(i=0;i<pool.length;i++)pool[i].write(buffer);
	//console.log(pool);
      };

    })
    .on('close',function() {
        console.log('socket close');
    })
    .on('end',function() {
        console.log('socket end');
    })
    .on('send',function(data) { //自定义事件
        //sock.write(wrap(data),'binary');
        //sock.write(data, "binary");
	//sock.write(decodeDataFrame(data).PayloadData, "binary");
    })
};

var get_part = function(key) {
    var empty   = '',
        spaces  = key.replace(/\S/g,empty).length,
        part    = key.replace(/\D/g,empty);
    if(!spaces) throw {message:'Wrong key: '+key,name:'HandshakeError'}
    return get_big_endian(part / spaces);
}

var get_big_endian = function(n) {  
    return String.fromCharCode.apply(null,[3,2,1,0].map(function(i) { return n >> 8*i & 0xff }))
}

var challenge = function(key1,key2,head) {
    var sum = get_part(key1) + get_part(key2) + head.toString('binary');
    return crypto.createHash('md5').update(sum).digest('binary');
}

var handshake = function(req,sock,head) {
    var output = [],h = req.headers, br = '\r\n';

    // header
    var ws = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        ,key = h["sec-websocket-key"]

	,c = crypto.createHash("sha1").update(key + ws).digest("base64"); 
    output.push(
        'HTTP/1.1 101 WebSocket Protocol Handshake',
	'Upgrade: websocket',
	'Connection: Upgrade',
        'Sec-WebSocket-Origin: ' + h.origin,
        'Sec-WebSocket-Location: ws://' + h.host + req.url,
        'Sec-WebSocket-Accept: ' + c
    );

	//console.log(output.concat("", "").join(br), "output");
    sock.write(output.concat("", "").join(br),'binary');
return c;
}
