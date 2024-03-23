const mongoose = require("mongoose");
const plm = require('passport-local-mongoose');

const userSchema = mongoose.Schema({
  username: String,
  email: String,
  contact: String,
  playList: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "playList",
    },
  ],
  like: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "song",
    },
  ],
  profileImage: {
    type: String,
    default: "/images/dummy.png",
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
});

userSchema.plugin(plm);

const userModel = mongoose.model("user", userSchema);

module.exports = userModel;
