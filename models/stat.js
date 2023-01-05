const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const statSchema = new Schema(
  {
    total_users: {
      type: Number,
      required: true,
    },
    total_orgs: {
      type: Number,
      required: true,
    },
    total_commits: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

const Stat = mongoose.model("Stat", statSchema);

module.exports = Stat;
