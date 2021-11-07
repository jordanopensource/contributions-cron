const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const userSchema = new Schema(
  {
    username: {
      // login
      type: String,
      required: true,
    },
    github_id: {
      type: String,
      required: true,
    },
    avatar_url: {
      type: String,
      required: true,
    },
    name: {
      type: String,
    },
    location: {
      type: String,
    },
    bio: {
      type: String,
    },
    company: {
      type: String,
    },
    isHireable: {
      type: Boolean,
    },
    github_profile_url: {
      // html_url
      type: String,
      required: true,
    },
    user_createdAt: {
      type: String,
    },
    commit_contributions: {
      type: Array,
    },
    score: {
      type: Number,
    },
    commitsTotalCount: {
      type: Number,
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

module.exports = User;
