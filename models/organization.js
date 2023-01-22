const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const organizationSchema = new Schema(
  {
    username: {
      // login
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
    github_profile_url: {
      // html_url
      type: String,
      required: true,
    },
    organization_createdAt: {
      type: String,
    },
    repositories: {
      type: Array,
    },
    members: {
      type: Array,
    },
    repositories_count: Number,
  },
  { timestamps: true }
);

const Organization = mongoose.model("Organization", organizationSchema);

module.exports = Organization;
