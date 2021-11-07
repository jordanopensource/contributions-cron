const mongoose = require("mongoose");
const { Octokit } = require("octokit");
const formatISO = require("date-fns/formatISO");
const addTime = require("date-fns/add");
const parseISO = require("date-fns/parseISO");

const Organization = require("./models/organization");
const User = require("./models/user");

require("dotenv").config({
  path: "./.env",
});

const octokit = new Octokit({
  auth: process.env.API_KEY,
});

const ConnectToDB = async () => {
  await mongoose
    .connect(process.env.DB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .then(() => console.log("Connected to DB"));
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

const IsInJordan = _location => {
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
    let userExists = await User.exists({ username: user.login });
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
      console.log(
        `User: ${newUser.username} and the location is ${newUser.location} was saved to DB`
      );
    } else {
      console.log(`User: ${user.login} Exists`);
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
  let extractedUsers = [];
  for (let index = 0; index < locationsToSearch.length; index++) {
    let result = await octokit.graphql(
      `{
        search(query: "location:${locationsToSearch[index]} type:user sort:joined", type: USER, first: 50) {
        userCount
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
      if (IsInJordan(user.location)) {
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
  if (userCommits.length <= 0) {
    console.log(`User: ${_user}, doesn't have commits`);
  }
  return userCommits;
};

const ExtractContributionsForUser = async (_user, _dateNow, _nextDay) => {
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
        contributionsCollection(from: "${_dateNow}", to: "${_nextDay}") {
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
        let repositoryExists = commitsContributions.some(
          x => x.repositoryName == node.repository.name
        );
        if (repositoryExists) {
          let objToUpdate = commitsContributions.find(
            element => element.repositoryName == node.repository.name
          );
          objToUpdate.starsCount = node.repository.stargazerCount;
          objToUpdate.commits = [...objToUpdate.commits, commitObj];
        } else {
          commitsContributions.push(newResult);
        }
      }
    }
  }
  return commitsContributions;
};

const SaveUserContributionsToDB = async () => {
  let dateNow = GetDateNow();
  let nextDay = GetNextDay();
  let users = await GetUsersFromDB({}, {});
  for (const user of users) {
    let userCommits = await ExtractContributionsForUser(user, dateNow, nextDay);
    if (userCommits.length > 0) {
      await User.updateOne(
        { username: user.username },
        { commit_contributions: userCommits }
      );
      console.log(`User: ${user.username}, Contributions Added`);
    } else {
      console.log(`User: ${user.username}, Contributions Not Added`);
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
        org_createdAt: org.createdAt,
      });
      await newOrg.save();
      console.log(
        `Organization: ${newOrg.username} and the location is ${newOrg.location} was saved to DB`
      );
    } else {
      console.log(`Organization: ${org.login} Exists`);
    }
  }
};

const GetOrganizationRepoFromDB = async _organization => {
  let org = await Organization.findOne({ username: _organization });
  let orgRepos = org.repositories;
  return orgRepos;
};

const SaveOrganizationsRepositoriesToDB = async () => {
  let organizations = await Organization.find({});
  for (const org of organizations) {
    let orgRepos = await ExtractOrganizationRepositoriesFromGithub(org);
    await Organization.updateOne(
      { username: org.username },
      { repositories: orgRepos }
    );
    console.log(`Organization: ${org.username}, Repositories Added`);
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
  let extractedOrganizations = [];
  for (let index = 0; index < locationsToSearch.length; index++) {
    let result = await octokit.graphql(`
        {
          search(query: "location:${locationsToSearch[index]} type:org sort:joined", type: USER, first: 30) {
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
    endCursor = await result.search.pageInfo.endCursor;
    let newOrg = await result.search.nodes;
    for (const org of newOrg) {
      if (IsInJordan(org.location)) {
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
  let hasNextPage = true;
  while (hasNextPage) {
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
    hasNextPage = await response.organization.repositories.pageInfo.hasNextPage;
  }

  return organizationRepositories;
};

const SyncOrganizations = async () => {
  await ExtractOrganizationsFromGithub();
  await SaveOrganizationsRepositoriesToDB();
  console.log("Database Finished Syncing Organizations");
};

const SyncUsers = async () => {
  await ExtractUsersFromGithub();
  await SaveUserContributionsToDB();
  console.log("Database Finished Syncing Users");
};

const CalculateScore = async () => {
  let users = await GetUsersFromDB({}, {});
  for (const user of users) {
    let score = 0;
    const userContributions = user.commit_contributions;
    for (const repository of userContributions) {
      let commits = repository.commits;
      for (const commit of commits) {
        let scoreToAdd = commit.commitCount * repository.starsCount;
        score += scoreToAdd;
      }
    }
    if (score > 0) {
      await User.updateOne({ username: user.username }, { score: score });
      console.log(`User: ${user.name}, score calculated: ${score}`);
    }
  }
};

const CalculateRepositoriesNumberForOrgs = async () => {
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
    console.log(
      `Org: ${org.username}, repositories Number: ${numberOfRepositories}`
    );
  }
};

const CalculateCommitsCountForUsers = async () => {
  let users = await User.find({});
  for (const user of users) {
    let userCommitsCount = 0;
    for (const repo of user.commit_contributions) {
      for (const commit of repo.commits) {
        userCommitsCount += commit.commitCount;
      }
    }
    await User.updateOne(
      { username: user.username },
      { commitsTotalCount: userCommitsCount }
    );
    console.log(
      `User: ${user.username}, user commits Count: ${userCommitsCount}`
    );
  }
};

async function main() {
  await ConnectToDB();
  //await SyncUsers();
  //await SyncOrganizations();
  //await CalculateScore();
  //await CalculateCommitsCountForUsers();
  //await CalculateRepositoriesNumberForOrgs();
  await mongoose.connection.close();
  console.log(
    "Mongoose default connection with DB is disconnected through app termination"
  );
}

main().catch(err => console.log(err));
