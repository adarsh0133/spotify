var express = require("express");
var router = express.Router();
var userModel = require("../models/userModel");
var songModel = require("../models/songModel");
var playlistModel = require("../models/playlistModel");
var multer = require("multer");
var id3 = require("node-id3");
const { Readable } = require("stream");
var crypto = require("crypto");

var passport = require("passport");
var localStrategy = require("passport-local");
passport.use(new localStrategy(userModel.authenticate()));
const mongoose = require("mongoose");

mongoose
  .connect(process.env.DATA_BASE)
  .then(() => {
    console.log("connected");
  })
  .catch((err) => {
    console.log(err);
  });

const conn = mongoose.connection;

var gfsBucket, gfsBucketPoster;

conn.once("open", () => {
  gfsBucket = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: "audio",
  });

  gfsBucketPoster = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: "poster",
  });
});

/* GET home page. */
router.get("/", isLoggedIn, async function (req, res, next) {
  const currentUser = await userModel
    .findOne({
      _id: req.user._id,
    })
    .populate("playList")
    .populate({
      path: "playList",
      populate: {
        path: "songs",
        model: "song",
      },
    });
  res.render("index", { currentUser });
});

// Songs Streaming routes

// router.get("/poster/:posterName", (req, res, next) => {
//   gfsBucketPoster.openDownloadStreamByName(req.params.posterName).pipe(res);
// });

router.get("/poster/:posterId", (req, res, next) => {
  const stream = gfsBucketPoster.openDownloadStream(
    ObjectId(req.params.posterId)
  );

  stream.on("error", (err) => {
    console.error(err);
    res.status(404).send("File not found");
  });

  stream.pipe(res);
});

// router.get("/stream", async (req, res, next) => {
//   const currentSong = await songModel.findOne({
//     filename: "684173adb572932ecfd74244d4e3b5aba3b267ef",
//   });

//   console.log(currentSong);

//     const stream = gfsBucket.openDownloadStreamByName("684173adb572932ecfd74244d4e3b5aba3b267ef");

//     res.set("Content-Type", "audio/mpeg");
//     res.set("Content-Length", currentSong.size + 1);
//     res.set("Content-Range",` bytes ${0} - ${currentSong.size - 1}/ ${currentSong.size}`);
//     res.set("Content-Ranges", "byte");
//     res.status(206);

//     stream.pipe(res);
// });

router.get("/stream/:musicName", async (req, res, next) => {
  const currentSong = await songModel.findOne({
    filename: req.params.musicName,
  });

  const range = req.headers.range;

  if (range && currentSong) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : currentSong.size - 1;

    const contentLength = end - start + 1;
    const contentRange = `bytes ${start}-${end}/${currentSong.size}`;

    res.status(206);
    res.set("Content-Type", "audio/mpeg");
    res.set("Content-Length", contentLength);
    res.set("Content-Range", contentRange);

    const stream = gfsBucket.openDownloadStreamByName(req.params.musicName, {
      start, // Start byte position
      end, // End byte position
    });

    stream.pipe(res);
  } else {
    res.status(200); // Set status to 200 for a full content response
    res.set("Content-Type", "audio/mpeg");
    res.set("Content-Length", currentSong.size);

    const fullStream = gfsBucket.openDownloadStreamByName(req.params.musicName);
    fullStream.pipe(res);
  }
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// router.post("/songupload",isLoggedIn,isAdmin, upload.array("song"),
//   async (req, res, next) => {
//     await Promise.all(
//       req.files.map(async (file) => {
//         const songData = id3.read(file.buffer);
//         const randomName = crypto.randomBytes(20).toString("hex");

//         Readable.from(file.buffer).pipe(gfsBucket.openUploadStream(randomName));
//         Readable.from(songData.image.imageBuffer).pipe(
//           gfsBucketPoster.openUploadStream(randomName + "poster")
//         );

//         await songModel.create({
//           title: songData.title,
//           artist: songData.artist,
//           album: songData.album,
//           size: file.size,
//           poster: randomName + "poster",
//           filename: randomName,
//         });
//       })
//     );
//     res.status(200).send('song uploaded successfully!')
//   }
// );

router.post(
  "/songupload",
  isLoggedIn,
  isAdmin,
  upload.array("song"),
  async (req, res, next) => {
    try {
      const newSongs = [];

      await Promise.all(
        req.files.map(async (file) => {
          const songData = id3.read(file.buffer);
          const randomName = crypto.randomBytes(20).toString("hex");

          // Check if songData has image property and it has imageBuffer property
          Readable.from(file.buffer).pipe(
            gfsBucket.openUploadStream(randomName)
          );

          // Readable.from(songData.image.imageBuffer).pipe(
          //   gfsBucketPoster.openUploadStream(randomName + "poster")
          // );

          if (songData.image && songData.image.imageBuffer) {
            Readable.from(songData.image.imageBuffer).pipe(
              gfsBucketPoster.openUploadStream(randomName + "poster")
            );
          }

          const newSong = await songModel.create({
            title: songData.title,
            artist: songData.artist,
            album: songData.album,
            size: file.size,
            poster: randomName + "poster", // Use the proper value from "poster.files"
            filename: randomName,
          });

          newSongs.push(newSong);
        })
      );

      res.status(200).send("Songs uploaded successfully!");
    } catch (error) {
      console.error(error);
      res.status(500).send("Internal Server Error");
    }
  }
);

router.get("/admin", isLoggedIn, isAdmin, (req, res, next) => {
  res.render("uploadMusic");
});

// --user authentication routes--

router.post("/register", (req, res, next) => {
  userModel.findOne({ username: req.body.username }).then((foundUser) => {
    if (foundUser) {
      // agar koi username pehale se ho to
      res.send("Username already exists");
    } else {
      // agar koi bhi same naam ka user na ho tab
      var newUser = new userModel({
        username: req.body.username,
        email: req.body.email,
      });
      userModel
        .register(newUser, req.body.password)
        .then(function (u) {
          passport.authenticate("local")(req, res, async function () {
            const songs = await songModel.find();
            const defaultPlaylist = await playlistModel.create({
              name: req.body.username,
              owner: req.user._id,
              songs: songs.map((song) => song._id),
            });

            console.log(songs.map((song) => song._id));

            const newUser = await userModel.findOne({
              _id: req.user._id,
            });

            newUser.playList.push(defaultPlaylist._id);

            await newUser.save();

            res.redirect("/");
          });
        })
        .catch((err) => {
          console.log(err);
        });
    }
  });
});

router.get("/register", (req, res, next) => {
  res.render("register");
});

router.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login",
  }),
  function (req, res, next) {}
);

router.get("/login", function (req, res, next) {
  res.render("login");
});

router.get("/logout", function (req, res, next) {
  req.logout(function (err) {
    if (err) return next(err);
    res.redirect("/login");
  });
});

function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  } else {
    res.redirect("/login");
  }
}

function isAdmin(req, res, next) {
  if (req.user.isAdmin) return next();
  else return res.redirect("/");
}
// --user authentication routes--

module.exports = router;
