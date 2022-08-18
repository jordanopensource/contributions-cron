const mongoose = require("mongoose");
const { Octokit } = require("octokit");
const formatISO = require("date-fns/formatISO");
const addTime = require("date-fns/add");
const parseISO = require("date-fns/parseISO");

const Organization = require("./models/organization");
const User = require("./models/user");

const { retryPromiseWithDelay } = require("./utils/retry.js");

require("dotenv").config({
  path: "./config.env",
});

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

const ConnectToDB = async () => {
  let DB_URL = 'mongodb://'+process.env.DATABASE_HOST+":"+process.env.DATABASE_PORT+'/'+process.env.DATABASE_NAME;
  if(process.env.NODE_ENV !== 'development'){
    // DB_URL
    // mongodb://username:password@host:port/database
    DB_URL = 'mongodb+srv://'+process.env.DATABASE_USER+':'+process.env.DATABASE_PASSWORD+'@'+process.env.DATABASE_HOST+'/'+process.env.DATABASE_NAME+'?authSource=admin&tls='+process.env.TLS_ENABLED+'&tlsCAFile='+process.env.CA_PATH+'';
  }
  await mongoose.connect(DB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.info("Connected to the database");
  console.info(
    `Database Host: ${mongoose.connection.host}\nDatabase Port: ${mongoose.connection.port}\nDatabase Name: ${mongoose.connection.name}`
  );
};

const GetLastRegisteredOrgDate = async () => {
  let lastOrganization = await Organization.findOne({}).sort({
    organization_createdAt: -1,
  });
  const date = new Date(lastOrganization.organization_createdAt);
  return date.toISOString().split("T")[0];
};

const GetDateNow = () => {
  let date = Date.now();
  date = formatISO(date, { representation: "date" });
  date = `${date}T00:00:00.000Z`;
  return date;
};

const GetNextDay = () => {
  let date = Date.now();
  date = formatISO(date, { representation: "date" });
  let nextDay = `${date}T23:59:59.999Z`;
  return nextDay;
};

const GetLastRegisteredUserDate = async () => {
  let lastUser = await User.findOne({}).sort({ user_createdAt: -1 });
  const date = new Date(lastUser.user_createdAt);
  return date.toISOString().split("T")[0];
};

const blockedRepos = ["first-contributions"];

const isRepoBlocked = _repoName => {
  for (const repo of blockedRepos) {
    return _repoName === repo;
  }
};

const isInJordan = _location => {
  const locationKeyWords = [
    "Irbid",
    "Aqaba",
    "Al-Karak",
    "Amman",
    "Madaba",
    "Zarqa",
    "Al-Zarqa",
    "AlSalt",
    "Ajloun",
    "Al-Mafraq",
    "Maan",
    "Jerash",
    "AlKarak",
  ];
  let locationFound = false;
  _location = _location.toLowerCase();

  if (_location === "jordan") {
    locationFound = true;
  } else {
    locationKeyWords.forEach(key => {
      key = key.toLowerCase();
      if (_location.includes(key) && !locationFound) {
        locationFound = true;
      }
    });
  }
  return locationFound;
};

const SaveUsersToDB = async _usersData => {
  for (const user of _usersData) {
    let userExists = await User.exists({ github_id: user.id });
    if (!userExists) {
      let newUser = new User({
        username: user.login,
        github_id: user.id,
        avatar_url: user.avatarUrl,
        name: user.name,
        location: user.location,
        bio: user.bio,
        company: user.company,
        isHireable: user.isHireable,
        github_profile_url: user.url,
        user_createdAt: user.createdAt,
      });
      await newUser.save();
      if (process.env.NODE_ENV !== "production") {
        console.log(
          `User: ${newUser.username} and the location is ${newUser.location} was saved to DB`
        );
      }
    } else {
      const doc = await User.findOne({ github_id: user.id });
      doc.username = user.login;
      doc.avatar_url = user.avatarUrl;
      doc.name = user.name;
      doc.location = user.location;
      doc.github_profile_url = user.url;

      if (isInJordan(doc.location)) {
        await doc.save();
      } else {
        await User.deleteOne({ github_id: user.id });
      }

      if (process.env.NODE_ENV !== "production") {
        console.log(`User: ${user.login} Exists`);
      }
    }
  }
};

const ExtractUsersFromGithub = async () => {
  let locationsToSearch = [
    "Jordan",
    "Amman",
    "Aqaba",
    "Madaba",
    "Irbid",
    "Zarqa",
    "Jerash",
    "Al-Karak",
    "Maan",
    "Ajloun",
  ];
  const startDate = await GetLastRegisteredUserDate();
  let extractedUsers = [];
  for (let index = 0; index < locationsToSearch.length; index++) {
    let result = await octokit.graphql(
      `{
        search(query: "location:${locationsToSearch[index]} type:user created:>=${startDate}", type: USER, first: 100) {
        nodes {
          ... on User {
            id
            login
            avatarUrl
            name
            location
            bio
            url
            company
            isHireable
            createdAt
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
        }
      }`
    );
    let newUsers = await result.search.nodes;
    for (const user of newUsers) {
      if (isInJordan(user.location)) {
        extractedUsers = [...extractedUsers, user];
      }
    }
  }
  await SaveUsersToDB(extractedUsers);
};

const GetUsersFromDB = async (_filter = {}, _sort = {}) => {
  const results = await User.find(_filter).sort(_sort);
  const documents = results;
  return documents;
};

const GetUserCommitContributionFromDB = async _user => {
  let user = await User.findOne({ username: _user });
  let userCommits = user.commit_contributions;
  return userCommits;
};

const ExtractContributionsForUser = async (
  _user,
  _firstDayOfTheYear,
  _dateNow
) => {
  try {
    let commitsContributions = await GetUserCommitContributionFromDB(
      _user.username
    );
    let commits = [];
    let newResult = {
      repositoryName: "",
      starsCount: 0,
      url: "",
      commits: commits,
    };
    let response = await octokit.graphql(`{
     user(login: "${_user.username}") {
        contributionsCollection(from: "${_firstDayOfTheYear}", to: "${_dateNow}") {
        commitContributionsByRepository {
        contributions(first: 100) {
            nodes {
              commitCount
              occurredAt
              repository {
                id
                name
                stargazerCount
                isPrivate
                url
              }
            }
          }
        }
      }
    }
  }`);

    let data =
      response.user.contributionsCollection.commitContributionsByRepository;

    for (const contribution of data) {
      let nodes = contribution.contributions.nodes;
      for (const node of nodes) {
        if (!node.repository.isPrivate) {
          let commitObj = {
            commitCount: node.commitCount,
            occurredAt: node.occurredAt,
          };
          newResult = {
            repositoryName: node.repository.name,
            starsCount: node.repository.stargazerCount,
            url: node.repository.url,
            commits: [...commits, commitObj],
          };
          if (!isRepoBlocked(newResult.repositoryName)) {
            let repositoryExists = commitsContributions.some(
              x => x.url === node.repository.url
            );
            if (repositoryExists) {
              let objToUpdate = commitsContributions.find(
                element => element.url === node.repository.url
              );
              let commitExists = objToUpdate.commits.some(
                x => x.occurredAt == node.occurredAt
              );

              objToUpdate["starsCount"] = node.repository.stargazerCount;
              if (!commitExists) {
                objToUpdate.commits = [...objToUpdate.commits, commitObj];
              }
            } else {
              commitsContributions.push(newResult);
            }
          }
        }
      }
    }
    return commitsContributions;
  } catch (err) {
    if (err.errors[0].type == "NOT_FOUND") {
      await User.deleteOne({ username: _user.username });
    } else {
      throw err;
    }
  }
};

const SaveUserContributionsToDB = async () => {
  const retries = 2;
  const wait = 3600000;
  let firstDayOfTheYear = `${new Date().getFullYear()}-01-01T00:00:00.000Z`;
  let dateNow = new Date().toISOString();
  let users = await GetUsersFromDB({}, {});
  for (const user of users) {
    try {
      let userCommits = await retryPromiseWithDelay(
        ExtractContributionsForUser(user, firstDayOfTheYear, dateNow),
        retries,
        wait
      );
      await User.updateOne(
        { username: user.username },
        { commit_contributions: userCommits }
      );
      if (process.env.NODE_ENV !== "production") {
        console.log(`User: ${user.username}, Contributions Updated`);
      }
    } catch (err) {
      throw err;
    }
  }
};

const SaveOrganizationsToDB = async _organizations => {
  for (const org of _organizations) {
    let orgExists = await Organization.exists({ username: org.login });
    if (!orgExists) {
      let newOrg = new Organization({
        username: org.login,
        github_id: org.id,
        avatar_url: org.avatarUrl,
        name: org.name,
        location: org.location,
        github_profile_url: org.url,
        organization_createdAt: org.createdAt,
      });
      await newOrg.save();
      if (process.env.NODE_ENV !== "production") {
        console.log(
          `Organization: ${newOrg.username} and the location is ${newOrg.location} was saved to DB`
        );
      }
    } else {
      if (process.env.NODE_ENV !== "production") {
        console.log(`Organization: ${org.login} Exists`);
      }
    }
  }
};

const GetOrganizationRepoFromDB = async _organization => {
  let org = await Organization.findOne({ username: _organization });
  let orgRepos = org.repositories;
  return orgRepos;
};

const SaveOrganizationsRepositoriesToDB = async () => {
  const retries = 2;
  const wait = 3600000;
  let organizations = await Organization.find({});
  for (const org of organizations) {
    try {
      let orgRepos = await retryPromiseWithDelay(
        ExtractOrganizationRepositoriesFromGithub(org),
        retries,
        wait
      );
      await Organization.updateOne(
        { username: org.username },
        { repositories: orgRepos }
      );
      if (process.env.NODE_ENV !== "production") {
        console.log(`Organization: ${org.username}, Repositories Added`);
      }
    } catch (err) {
      throw err;
    }
  }
};

const ExtractOrganizationsFromGithub = async () => {
  let locationsToSearch = [
    "Jordan",
    "Amman",
    "Aqaba",
    "Madaba",
    "Irbid",
    "Zarqa",
    "Jerash",
    "Al-Karak",
    "Maan",
    "Ajloun",
  ];
  const startDate = await GetLastRegisteredOrgDate();
  let extractedOrganizations = [];
  for (let index = 0; index < locationsToSearch.length; index++) {
    let result = await octokit.graphql(`
        {
          search(query: "location:${locationsToSearch[index]} type:org created:>=${startDate}", type: USER, first: 100) {
          userCount
          nodes {
          ... on Organization {
            id
            login
            avatarUrl
            name
            location
            url
            createdAt
          }
        }
        pageInfo {
        endCursor
        hasNextPage
      }
  }
}`);
    let newOrg = await result.search.nodes;
    for (const org of newOrg) {
      if (isInJordan(org.location)) {
        extractedOrganizations = [...extractedOrganizations, org];
      }
    }
  }
  await SaveOrganizationsToDB(extractedOrganizations);
};

const ExtractOrganizationRepositoriesFromGithub = async _organization => {
  let organizationRepositories = await GetOrganizationRepoFromDB(
    _organization.username
  );
  let endCursor = null;
  let hasNextPage = true;
  while (hasNextPage) {
    try {
      let pageCursor = endCursor === null ? `${endCursor}` : `"${endCursor}"`;
      let response = await octokit.graphql(`{
        organization(login: "${_organization.username}") {
          repositories(privacy: PUBLIC, first: 100, after: ${pageCursor}) {
            nodes {
              name
              stargazerCount
            }
          pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }`);

      endCursor = await response.organization.repositories.pageInfo.endCursor;
      let data = response.organization.repositories.nodes;

      for (const repo of data) {
        let newResult = {
          name: repo.name,
          starsCount: repo.stargazerCount,
        };
        let repositoryExists = organizationRepositories.some(
          x => x.name == repo.name
        );
        if (repositoryExists) {
          let objToUpdate = organizationRepositories.find(
            element => element.name == repo.name
          );
          objToUpdate.starsCount = repo.stargazerCount;
        } else {
          organizationRepositories.push(newResult);
        }
      }

      hasNextPage = await response.organization.repositories.pageInfo
        .hasNextPage;
      return organizationRepositories;
    } catch (err) {
      if (err.errors[0].type == "NOT_FOUND") {
        await Organization.deleteOne({ username: _organization.username });
      } else {
        throw err;
      }
    }
  }
};

const UpdateOrganizationsInfo = async () => {
  const orgs = await Organization.find({});
  for (const org of orgs) {
    const orgCreatedAt = await ExtractOrganizationCreateDate(org.username);
    if (orgCreatedAt) {
      await Organization.updateOne(
        { username: org.username },
        { organization_createdAt: orgCreatedAt }
      );
    }
  }
};

const ExtractOrganizationCreateDate = async _orgUsername => {
  try {
    let response = await octokit.graphql(`{
        organization(login: "${_orgUsername}") {
          createdAt
        }
  }`);
    return response.organization.createdAt;
  } catch (err) {
    if ((err.type = "NOT_FOUND")) {
      await Organization.deleteOne({ username: _orgUsername });
    }
  }
};

const ExtractOrganizationMembers = async _orgUsername => {
  try {
    let response = await octokit.graphql(`{
        organization(login: "${_orgUsername}") {
          membersWithRole(first: 100) {
            nodes {
              id
              login
              name
              avatarUrl
              url
            }
          }
        }
  }`);
    let members = response.organization.membersWithRole.nodes;
    return members;
  } catch (err) {
    if (err.type === "NOT_FOUND") {
      await Organization.deleteOne({ username: _orgUsername });
    }
  }
};

const UpdateOrganizationsMembers = async () => {
  const orgs = await Organization.find({});
  for (const org of orgs) {
    const members = await ExtractOrganizationMembers(org.username);
    if (members) {
      await Organization.updateOne(
        { username: org.username },
        { members: members }
      );
    }
  }
};

const SyncOrganizations = async () => {
  console.log(
    "Database Started Syncing Organizations\n-------------------------"
  );
  await ExtractOrganizationsFromGithub();
  await SaveOrganizationsRepositoriesToDB();
  // await UpdateOrganizationsInfo();
  await UpdateOrganizationsMembers();
  console.log(
    "Database Finished Syncing Organizations\n-------------------------"
  );
};

const SyncUsers = async () => {
  console.log("Database Started Syncing Users\n-------------------------");
  await ExtractUsersFromGithub();
  await SaveUserContributionsToDB();
  console.log("Database Finished Syncing Users\n-------------------------");
};

const CalculateScore = async () => {
  console.log("Cron Started Calculating Score\n-------------------------");
  let users = await GetUsersFromDB({}, {});
  for (const user of users) {
    let score = 0;
    const userContributions = user.commit_contributions;
    for (const repository of userContributions) {
      let last30DaysCommits = GetLast30DaysCommits(repository.commits);
      for (const commit of last30DaysCommits) {
        let scoreToAdd = commit.commitCount * repository.starsCount;
        score += scoreToAdd;
      }
    }

    await User.updateOne({ username: user.username }, { score: score });
    if (process.env.NODE_ENV !== "production") {
      console.log(`User: ${user.name}, score calculated: ${score}`);
    }
  }
  console.log("Cron Finished Calculating Score\n-------------------------");
};

const CalculateRepositoriesNumberForOrgs = async () => {
  console.log(
    "Cron Started Calculating Repositories Number For The Organizations\n-------------------------"
  );

  let orgs = await Organization.find({});
  for (const org of orgs) {
    let numberOfRepositories = 0;
    for (const repo of org.repositories) {
      numberOfRepositories += 1;
    }
    await Organization.updateOne(
      { username: org.username },
      { repositories_count: numberOfRepositories }
    );
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `Org: ${org.username}, repositories Number: ${numberOfRepositories}`
      );
    }
  }
  console.log(
    "Cron Finished Calculating Repositories Number For The Organizations\n-------------------------"
  );
};

const CalculateCommitsCountForUsers = async () => {
  console.log(
    "Cron Started Calculating Commits Count For The Users\n-------------------------"
  );
  let users = await User.find({});
  for (const user of users) {
    let userCommitsCount = 0;
    for (const repo of user.commit_contributions) {
      const last30DaysCommits = GetLast30DaysCommits(repo.commits);
      for (const commit of last30DaysCommits) {
        userCommitsCount += commit.commitCount;
      }
    }
    await User.updateOne(
      { username: user.username },
      { commitsTotalCount: userCommitsCount }
    );
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `User: ${user.username}, user commits Count: ${userCommitsCount}`
      );
    }
  }
  console.log(
    "Cron Finished Calculating Commits Count For The Users\n-------------------------"
  );
};

const RankUsersByScore = _usersArray => {
  console.log("Cron Started Ranking Users By Score\n-------------------------");
  let startingRank = 1;
  let currentRank = startingRank;
  let rankValue = null;
  let userRanks = [];

  let usersSorted = _usersArray.slice().sort((a, b) => {
    return b.score - a.score;
  });
  usersSorted.forEach(user => {
    if (user.score !== rankValue && rankValue !== null) {
      currentRank++;
    }
    userRanks.push({
      user,
      currentRank,
    });
    rankValue = user.score;
  });

  console.log(
    "Cron Finished Ranking Users By Score\n-------------------------"
  );
  return userRanks;
};

const RankUsersByContributions = _usersArray => {
  console.log(
    "Cron Started Ranking Users By Contributions\n-------------------------"
  );
  let startingRank = 1;
  let currentRank = startingRank;
  let rankValue = null;
  let userRanks = [];

  let usersSorted = _usersArray.sort((a, b) => {
    return b.commitsTotalCount - a.commitsTotalCount;
  });
  usersSorted.forEach(user => {
    if (user.commitsTotalCount !== rankValue && rankValue !== null) {
      currentRank++;
    }
    userRanks.push({
      user,
      currentRank,
    });
    rankValue = user.commitsTotalCount;
  });

  console.log(
    "Cron Finished Ranking Users By Contributions\n-------------------------"
  );
  return userRanks;
};

const UpdateUsersScoreRanks = async () => {
  console.log(
    "Cron Started Updating Users Score Ranks\n-------------------------"
  );
  let users = await User.find({}, "username score").sort({
    score: -1,
    _id: 1,
  });
  const usersRankedByScore = RankUsersByScore(users);

  for (const element of usersRankedByScore) {
    const doc = await User.findOne({ "username": element.user.username });
    doc.score_rank = element.currentRank;
    const saved = await doc.save();

    if (process.env.NODE_ENV !== "production") {
      if (saved) {
        console.log(`User ${element.user.username} Got Saved`);
      }
    }
  }
  console.log(
    "Cron Finished Updating Users Score Ranks\n-------------------------"
  );
};

const UpdateUsersContributionsRanks = async () => {
  console.log(
    "Cron Started Updating Users Contributions Ranks\n-------------------------"
  );
  let users = await User.find({}, "username commitsTotalCount").sort({
    commitsTotalCount: -1,
    _id: 1,
  });
  const usersRankedByContributions = RankUsersByContributions(users);

  for (const element of usersRankedByContributions) {
    const doc = await User.findOne({ "username": element.user.username });
    doc.contributions_rank = element.currentRank;
    const saved = await doc.save();

    if (process.env.NODE_ENV !== "production") {
      if (saved) {
        console.log(`User ${element.user.username} Got Saved`);
      }
    }
  }
  console.log(
    "Cron Finished Updating Users Contributions Ranks\n-------------------------"
  );
};

const UpdateUsersRanks = async () => {
  await UpdateUsersScoreRanks();
  await UpdateUsersContributionsRanks();
};

const GetLast30DaysCommits = _commitsList => {
  const currentDate = new Date();
  const currentDateTime = currentDate.getTime();
  const last30DaysDate = new Date(
    currentDate.setDate(currentDate.getDate() - 30)
  );
  const last30DaysDateTime = last30DaysDate.getTime();
  const lastMonthsCommits = _commitsList.filter(commit => {
    const elementDateTime = new Date(commit.occurredAt).getTime();
    if (
      elementDateTime <= currentDateTime &&
      elementDateTime > last30DaysDateTime
    ) {
      return true;
    }
    return false;
  });

  return lastMonthsCommits;
};

async function main() {
  await ConnectToDB();
  await SyncUsers();
  await SyncOrganizations();
  await CalculateScore();
  await CalculateCommitsCountForUsers();
  await CalculateRepositoriesNumberForOrgs();
  await UpdateUsersRanks();

  await mongoose.connection.close();
  console.log(
    "Mongoose default connection with DB is disconnected, the job is finished."
  );
  process.exit(0); // program will exit successfully
}

main();

// listen for uncaught exceptions events
process.on("uncaughtException", async err => {
  await mongoose.connection.close(); // close the database connection before exiting
  console.error(`Error while doing my job "THE ERROR": ${err}`); // logging the uncaught error
  process.exit(1); // exit with failure
});

// listen to the signal that tells the program to gracefully terminate.
process.on("SIGTERM", async () => {
  await mongoose.connection.close(); // close the database connection before exiting
  console.log(`Program is gracefully terminating`); // logging the termination
  process.exit(0); // exit with success
});
