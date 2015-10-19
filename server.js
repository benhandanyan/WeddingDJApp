var http = require('http');
var path = require('path');
var socketio = require('socket.io');
var express = require('express');
var fs = require('fs');
var crypto = require('crypto');
var jwt = require('jsonwebtoken');
var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;
var ejwt = require('express-jwt');
var bodyParser = require('body-parser');

// create server
var router = express();
var server = http.createServer(router);
var auth = ejwt({secret: 'SECRET', userProperty: 'payload'});
var io = socketio.listen(server);

var images = [];
var guestbook = [];
var captions = [];
var sockets = [];

router.use(bodyParser.urlencoded({
    extended: true
}));
router.use(bodyParser.json());
router.use(passport.initialize());

router.use(express.static(path.resolve(__dirname, 'client')));

io.on('connection', function (socket) {
    console.log("NEW CONNECTION");

    sockets.push(socket);

    socket.on('disconnect', function () {
      sockets.splice(sockets.indexOf(socket), 1);
      //updateRoster();
    });
    
    socket.on('message', function(data) {
      guestbook.push([data.name,data.message]);
      broadcast('message', data);
    });
    
    socket.emit('initialPic', images);
    socket.emit('initialGuestbook', guestbook);

    // socket.on('identify', function (name) {
    //   socket.set('name', String(name || 'Anonymous'), function (err) {
    //     updateRoster();
    //   });
    // });
  });

// function updateRoster() {
//   async.map(
//     sockets,
//     function (socket, callback) {
//       socket.get('name', callback);
//     },
//     function (err, names) {
//       broadcast('roster', names);
//     }
//   );
// }

// DATABASE

//require mongoose
var mongoose = require('mongoose');

//connect to the database
mongoose.connect("mongodb://localhost:29792/weddingdj", function(err, db) {
    if (!err) {
        console.log("We are connected to the database");
    } else {
        console.log("*** There was an error connecting to the database ***");
    }
});

var GuestbookSchema = new mongoose.Schema({
  name: String,
  post: String
})

var PlaylistSchema = new mongoose.Schema({
  name: String,
  title: String,
  upvotes: {type: Number, default: 0}
})

PlaylistSchema.methods.upvote = function(cb) {
  this.upvotes += 1;
  this.save(cb);
};


//schema for users (guests) to login
var UserSchema = new mongoose.Schema({
  username: {type: String, lowercase: true, unique: true},
  hash: String,
  salt: String
});

//method for setting password
UserSchema.methods.setPassword = function(password){
  this.salt = crypto.randomBytes(16).toString('hex');

  this.hash = crypto.pbkdf2Sync(password, this.salt, 1000, 64).toString('hex');
};

//method for validating password
UserSchema.methods.validPassword = function(password) {
  var hash = crypto.pbkdf2Sync(password, this.salt, 1000, 64).toString('hex');

  return this.hash === hash;
};

UserSchema.methods.generateJWT = function() {

  // set expiration to 60 days
  var today = new Date();
  var exp = new Date(today);
  exp.setDate(today.getDate() + 60);

  return jwt.sign({
    _id: this._id,
    username: this.username,
    exp: parseInt(exp.getTime() / 1000),
  }, 'SECRET');
};

mongoose.model('User', UserSchema);
mongoose.model('Guestbook', GuestbookSchema);
mongoose.model('Playlist', PlaylistSchema);

var User = mongoose.model('User');
var Guestbook = mongoose.model('Guestbook');
var Playlist = mongoose.model('Playlist');

passport.use(new LocalStrategy(
  function(username, password, done) {
    User.findOne({ username: username }, function (err, user) {
      if (err) { return done(err); }
      if (!user) {
        return done(null, false, { message: 'Incorrect username or password.' });
      }
      if (!user.validPassword(password)) {
        return done(null, false, { message: 'Incorrect username or password.' });
      }
      return done(null, user);
    });
  }
));

function broadcast(event, data) {
  sockets.forEach(function (socket) {
    socket.emit(event, data);
  });
}


router.post('/file-upload', function(req, res) {
    var tmp_path = req.files.image.path;
    var target_path = '/home/bhandanyan/webapps/weddingdj/client/uploaded_images/' + req.files.image.name;
    images.push(req.files.image.name);
    fs.rename(tmp_path, target_path, function(err) {
        if (err) throw err;
        fs.unlink(tmp_path, function() {
            if (err) throw err;
            //res.send('File uploaded to: ' + target_path + ' - ' + req.files.image.size + ' bytes');
            broadcast('upload', req.files.image.name);
            console.log('upload broadcasted');
            return false;
        });
    });
});

router.post('/login', function(req, res, next){
  if(!req.body.username || !req.body.password){
    return res.status(400).json({message: 'Please fill out all fields'});
  }

  passport.authenticate('local', function(err, user, info){
    if(err){ return next(err); }

    if(user){
      return res.json({token: user.generateJWT()});
    } else {
      return res.status(401).json(info);
    }
  })(req, res, next);
});

router.get('/guest', function(req, res, next) {
  Guestbook.find(function(err, posts){
    if (err) { return next(err); }
    res.json(posts);
  });
});

router.post('/guest',function(req, res, next) {
  var post = new Guestbook(req.body);

  post.save(function(err, post){
    if(err){ return next(err); }

    res.json(post);
  });

});

router.get('/song', function(req, res, next) {
  Playlist.find(function(err, songs) {
    if(err) {return next(err);}
    res.json(songs);
  });
});

router.param('song', function(req, res, next, id) {
  var query = Playlist.findById(id);
  
    query.exec(function (err, song){
    if (err) { return next(err); }
    if (!song) { return next(new Error('can\'t find song')); }

    req.song = song;
    return next();
    });
})

router.post('/song', function(req, res, next) {
  var song = new Playlist(req.body);

  song.save(function(err, song) {
    if(err) {return next(err);}
    res.json(song);
  });
});

router.put('/songs/:song/upvote', function(req, res, next) {
  req.song.upvote(function(err,song) {
    if(err){
      return next(err);
    }
    res.json(song);
  });
});

//this is where we actually turn to the outside world.  You'll need 
//to adjust if you are on some other server
server.listen(12561, "0.0.0.0", function() {
    var addr = server.address();
    console.log("listening to server");
});
