// Require the packages we will use:
// var http = require("http"),
var socketio = require("socket.io"),
    fs = require("fs"),
    express = require("express"),
    multer = require('multer'),
    path = require("path");


// var util = require('util'); // display the attr of obj in terminal
// var $ = require('jquery');

// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html:
// var app = http.createServer(function(req, resp){
// 	// This callback runs when a new connection is made to our HTTP server.
// 	fs.readFile("client.html", function(err, data){
// 		// This callback runs when the client.html file has been read from the filesystem.
// 		if(err) return resp.writeHead(500);
// 		resp.writeHead(200);
// 		resp.end(data);
// 	});
// });
// app.listen(8000);

//use multer to deal with file
var storage =  multer.diskStorage({
    destination: function (req, file, callback) {
        callback(null, path.join(__dirname, '/public'));//the directory where the file is uploaded
    },
    filename: function (req, file, callback) {
        callback(null,file.originalname);
    }
});
var upload = multer({ storage : storage}).single('userFile');



var app = express();
var server = app.listen(8000);
var io = socketio.listen(server);

app.get("/", function (req, res) {
    res.sendFile(__dirname + '/client.html');
});


//multer
// app.post('/api/file',function(req,res){
//     upload(req,res,function(err) {
//         if(err) {
//             console.log(err);
//             return res.end("Error uploading file.");
//         }
//         res.redirect("back");
//     });
// });

/**
 * handle public files
 */
app.use(express.static(path.join(__dirname, '/public')));
app.use(express.static(path.join(__dirname, '/uploaded_files')));
app.get("/client.css", function (req, res) {
    res.sendFile(__dirname + "/client.css");
});


// app.get('/api/file',function(req,res){
//     upload(req,res,function(err) {
//         if(err) {
//             console.log(err);
//             return res.end("Error uploading file.");
//         }
//         res.redirect("back");
//         // res.end();
//     });
// });

/**
 * room_name: {object}room
 */
var rooms_list = {};

function Room(r, u, s_id, isPrivate, pwd){
    this.name = r;
    this.owner_username = u;
    this.s_id = s_id;
    this.isPrivate = isPrivate;
    this.pwd = pwd;
    this.members = {}; //key:username, value:s_id
    this.banned = [];
}

function dismiss(socket, io, all){
    console.log("start kicking in room:" + socket.room);
    if(all){
        io.in(socket.room).emit("kick_yourself",{username:"sys", msg:"your are kicked from "+socket.room});
        // rooms_list[socket.room] = null;
    } else {
        socket.emit("kick_yourself",{username:"sys", msg:"your are kicked from "+socket.room});
    }
}



/**
 * init
 */
io.on("connection", function (socket) {
    //multer
    app.post('/api/file',function(req,res){
        // console.log(Object.keys(req));
        upload(req,res,function(err) {
            if(err) {
                console.log(err);
                return res.end("Error uploading file.");
            }
            res.redirect("back");
        });
    });

    socket.emit("msg_from_server", {username:"sys", msg:"rooms available:" + Object.keys(io.sockets.adapter.rooms)});

    /**
     * we only socket to be in one room only
     */
    socket.on('join_public', function (d) {
        // do not care which room you are in, just leave and enter the new room

        if (socket.room) {
            if(socket.room==d.room) return;
            var old_room = socket.room;
            var old_name = socket.name;
            socket.leave(socket.room, function (err) {
                if (err) {
                    socket.emit("msg_from_server", {msg: "err" + err});
                } else {
                    //we can not do shit here because callback is so delayed
                }
            });
            io.in(socket.room).emit("msg_from_server", {username:"sys!",msg: socket.username +" left room " + old_room});
            console.log("debug: " + rooms_list[old_room]);
            console.log("debug: " + old_room);
            var m = rooms_list[old_room].members;
            // var i = m.indexOf(socket.username);
            // if(i>-1) m.slice(i,1);
            m[old_name] = null;
            if(Object.keys(m).length===0) m = null;
            if (rooms_list[old_room].s_id==socket.id){
                //dismiss the room since ownser left
                dismiss(socket, io, true);
            }
        }

        socket.username = d.username;

        // if its a private room we reject it
        if (rooms_list[d.room] && rooms_list[d.room].isPrivate){
            socket.emit('error', 'this is a private room! need pwd');
        } else {

            socket.room = d.room;
            socket.join(socket.room, function (err) {
                if (err) {
                    socket.emit("error", {msg: err});
                } else if (rooms_list[socket.room]) {
                    if(rooms_list[d.room].banned.indexOf(d.username) != -1){
                        // console.log("is banned? " + d.username);
                        socket.emit("msg_from_server",{username:"sys", msg:"your name and your socket are banned"});
                        return;
                    }
                    io.in(d.room).emit("msg_from_server", {username: "sys", msg: socket.username + " joined public room " + socket.room });
                    rooms_list[d.room].members[d.username] = socket.id;
                    socket.emit("cmd_from_server",{command:"be_member"});
                    // console.log("deubg: " + rooms_list[d.room].members);
                } else {
                    // we are the owner is wont be add the members
                    // console.log("debug: new Room" );
                    rooms_list[socket.room] = new Room(socket.room, socket.username, socket.id, false, null);
                    // console.log("debug: " + rooms_list[socket.room].members);
                    socket.emit("msg_from_server", {username:"sys", msg:"you create a public oom: "+socket.room});
                    socket.emit("cmd_from_server",{command:"be_owner"});
                    rooms_list[d.room].members[socket.username] = socket.id;
                }
                // console.log("debug: rooms - " + util.inspect(io.sockets.adapter.rooms, false, null));
            });
        }
    });
    /**
     * try to join a private room
     */
    socket.on('join_private', function (d) {
        if (socket.room) {
            if(socket.room==d.room) return;
            socket.leave(socket.room, function (err) {
                if (err) {
                    socket.emit("msg_from_server", {msg: "err" + err});
                } else {
                    //we can not do shit here because callback is so delayed
                }
            });
            io.in(socket.room).emit("msg_from_server", {username:"sys", msg: socket.username +" left room " + socket.room});
            // console.log(socket.room);
            var m = rooms_list[socket.room].members;
            var i = m.indexOf(socket.username);
            if(i>-1) m.slice(i,1);

            if (rooms_list[socket.room].s_id==socket.id){
                //dismiss the room since ownser left
                dismiss(socket, io);
            }
        }

        socket.username = d.username;
        if(rooms_list[d.room]){
            if(rooms_list[d.room].banned.indexOf(d.username) != -1){
                console.log("is banned? " + d.username);
                socket.emit("msg_from_server",{username:"sys", msg:"you are banned"});
                return;
            }
            if(rooms_list[d.room].pwd == d.pwd){
                socket.room = d.room;
                socket.join(d.room, function (err){
                    if (err){
                        socket.emit("msg_from_server", {username:"sys", msg: "err" + err});
                    } else {
                        io.in(d.room).emit("msg_from_server", {
                            username: "sys",
                            msg: socket.username + " joined private room " + socket.room
                        });
                        socket.emit("cmd_from_server",{command:"be_member"});
                        rooms_list[d.room].members[d.username] = socket.id;
                    }
                });

            } else socket.emit("msg_from_server", {username:"sys", msg: "wrong pwd"});
        } else { //room not exist, create a new one
            socket.room = d.room;
            socket.join(d.room, function (err){
                if (err){
                    socket.emit("msg_from_server", {username:"sys", msg: "err" + err});
                } else {
                    rooms_list[d.room] = new Room(d.room, d.username, socket.id, true, d.pwd);
                    rooms_list[d.room].members[d.username] = socket.id;
                    console.log("room "+ d.room + "created by " + d.username);
                    socket.emit("msg_from_server", {username:"sys", msg:"you created a privateroom: " + socket.room});
                    socket.emit("cmd_from_server",{command:"be_owner"});
                }
            });
        }
    });

    socket.on('msg_to_room', function (d) {
        //check if socket is in a room
        if (socket.room ){
            io.in(socket.room).emit("msg_from_server", {username:socket.username, msg:d.msg});
        } else {
            // console.log("debug: " + d);
            // console.log(socket.id + " to " + socket.room + ": " + d.msg);
            socket.emit("msg_from_server",{username:"sys", msg:"you need to join a room first!"});
        }
    });

    socket.on('msg_to_user', function (d) {
        //check if socket is in a room
        if (socket.room){
            socket.broadcast.to(rooms_list[socket.room].members[d.receiver]).emit("msg_from_server", {username:d.username, msg:"(private)"+d.msg});
        } else {
            socket.emit("msg_from_server",{username:"sys", msg:"you need to join a room first!"});
            // console.log("debug: " + d);
            // console.log(socket.id + " to " + socket.room + ": " + d.msg);
            // io.in(socket.room).emit("msg_from_server", {username:d.username, msg:"(private)"+d.msg});
        }
    });
    
    socket.on('user_typing', function (d) {
        //check if socket is in a room
        if (socket.room ){
            // console.log("debug: " + d);
            // console.log(socket.id + " to " + socket.room + ": " + d.msg);
            io.in(socket.room).emit("user_typing", {username:socket.username, msg:d.msg});
        }
    });

    /**
     * one socket in one room only, so we only notify one room
     */
    //TODO
    // when owner left, kick out everyone
     socket.on('disconnect', function () {
        console.log(socket.username + " is gone from " + socket.room);
        if(socket.room){
            if (rooms_list[socket.room].owner_username == socket.username) {
                dismiss(socket,io, true);
            } else {
                io.in(socket.room).emit("msg_from_server",{username:"sys", msg:socket.username + " left the room"});
                // var m = rooms_list[socket.room].members;
                // var i = m.indexOf(socket.username);
                // if(i>-1) m.slice(i,1);
            }
        }
    });
    
    socket.on('kick_myself_ack', function (d) {
        if(socket.room){
            socket.leave(socket.room);
            var m = rooms_list[socket.room].members;
            delete m[socket.username];
            delete rooms_list[socket.room];
            // console.log(m);
            // var i = m.indexOf(socket.username);
            // if(i>-1) m.slice(i,1);
            socket.room = null;
        }
    });

    socket.on("kick_victim", function (d) {
        io.in(socket.room).emit("sys_kick",{username:"sys", msg:d.victim + " is kicked from "+socket.room, victim:d.victim});
        // socket.room = null;
    });

    socket.on("ban_victim", function (d) {
        io.in(socket.room).emit("sys_ban",{username:"sys", msg:d.victim + " is banned from "+socket.room, victim:d.victim});
        rooms_list[socket.room].banned.push(d.victim);
        // socket.room = null;
    });

    socket.on("show_files", function (d) {
        fs.readdir(__dirname+"/uploaded_files", function(err, files) {
            socket.emit("msg_from_server", {username:"sys", msg:files});
        });
    });

    socket.on("show_users", function(){
        console.log("show users");
        if(socket.room){
            socket.emit("msg_from_server",{username:"sys", msg:Object.keys(rooms_list[socket.room].members)});
        }
    });

    socket.on("show_rooms",function(){
        console.log("show rooms");
        socket.emit("msg_from_server",{usernmae:"sys", msg:Object.keys(io.sockets.adapter.rooms)});
    });
});