const mongoose = require("mongoose");
const { Octokit } = require("octokit");
const fs = require("fs");
const { newLogger } = require("./utils/logger.js");

// loggers
const cronLogger = newLogger("cron");
const dbLogger = newLogger("db");
const ioLogger = newLogger("io");
const octokitLogger = newLogger("github");

const Organization = require("./models/organization");
const User = require("./models/user");
const Stat = require("./models/stat");

const { retryPromiseWithDelay } = require("./utils/retry.js");

const blacklistDirPath = "./blacklists";

const getBlockedRepos = () => {
  const blockedRepos = [];
  // read the file as a utf-8 encoded string
  fs.readFile(`${blacklistDirPath}/repos.txt`, "utf-8", (err, data) => {
    if (err) {
      // handle the error
      ioLogger.error(JSON.stringify(err));
      return;
    }

    // split the data into an array of names
    const repoNames = data.split("\n");

    repoNames.forEach(repoName => {
      blockedRepos.push(repoName);
    });
  });
  return blockedRepos;
};

const getBlockedUsers = () => {
  const blockedUsers = [];
  // read the file as a utf-8 encoded string
  fs.readFile(`${blacklistDirPath}/users.txt`, "utf-8", (err, data) => {
    if (err) {
      // handle the error
      ioLogger.error(JSON.stringify(err));
      return;
    }

    // split the data into an array of names
    const usernames = data.split("\n");

    usernames.forEach(username => {
      blockedUsers.push(username);
    });
  });
  return blockedUsers;
};

const blockedRepos = getBlockedRepos();
const blockedUsers = getBlockedUsers();

require("dotenv").config({
  path: "./.env",
});

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

const ConnectToDB = async () => {
  let DB_URL =
    "mongodb://" +
    process.env.DATABASE_HOST +
    ":" +
    process.env.DATABASE_PORT +
    "/" +
    process.env.DATABASE_NAME;
  if (process.env.NODE_ENV !== "development") {
    // DB_URL
    // mongodb://username:password@host:port/database
    DB_URL =
      "mongodb+srv://" +
      process.env.DATABASE_USER +
      ":" +
      process.env.DATABASE_PASSWORD +
      "@" +
      process.env.DATABASE_HOST +
      "/" +
      process.env.DATABASE_NAME +
      "?authSource=admin&tls=" +
      process.env.TLS_ENABLED +
      "&tlsCAFile=" +
      process.env.CA_PATH +
      "";
  }
  await mongoose.connect(DB_URL);
  dbLogger.info("Connected to the database");
  dbLogger.info(`Database Host: ${mongoose.connection.host}`);
  dbLogger.info(`Database Name: ${mongoose.connection.name}`);
  dbLogger.info(`Database Port: ${mongoose.connection.port}`);
};

const isRepoBlocked = _repoName => {
  for (const repo of blockedRepos) {
    return _repoName === repo;
  }
};

const isUserBlocked = _username => {
  for (const user of blockedUsers) {
    return _username === user;
  }
};

const isInJordan = _location => {
  if (!_location) {
    return false;
  }
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
    if (!isUserBlocked(user.login)) {
      let userExists = await User.exists({ username: user.login });
      if (!userExists) {
        let newUser = new User({
          username: user.login,
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
          dbLogger.info(
            `User: ${newUser.username} and the location is ${newUser.location} was saved to DB`
          );
        }
      } else {
        if (isInJordan(user.location)) {
          await User.updateOne(
            { username: user.login },
            {
              avatar_url: user.avatarUrl,
              name: user.name,
              location: user.location,
              github_profile_url: user.url,
              bio: user.bio,
              company: user.company,
            }
          );
        } else {
          await User.deleteOne({ username: user.login });
          dbLogger.info(
            `User ${user.name} has been removed due to the location not being jordan`
          );
        }
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

  let extractedUsers = [];
  for (let index = 0; index < locationsToSearch.length; index++) {
    let endCursor = null;
    let hasNextPage = true;
    while (hasNextPage) {
      let pageCursor = endCursor === null ? `${endCursor}` : `"${endCursor}"`;
      let result = await octokit.graphql(
        `{
        search(query: "location:${locationsToSearch[index]} type:user", type: USER, first: 100, after: ${pageCursor}) {
        nodes {
          ... on User {
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
      hasNextPage = await result.search.pageInfo.hasNextPage;
      endCursor = await result.search.pageInfo.endCursor;
    }
  }
  await SaveUsersToDB(extractedUsers);
};

const GetUsersFromDB = async (_filter = {}, _fields, _sort = {}) => {
  const results = await User.find(_filter, _fields).sort(_sort);
  const documents = results;
  return documents;
};

const CleanDatabase = async () => {
  cronLogger.info("Starting database cleanup...");
  const users = await GetUsersFromDB({}, "username");
  // Create an empty array to group the users we want to delete
  const usersToDelete = [];
  for (const user of users) {
    try {
      let result = await octokit.graphql(
        `{
          user(login: "${user.username}") {
            location
          }
        }`
      );
      const userLocation = await result.user.location;

      if (!isInJordan(userLocation)) {
        // If the user location is not in jordan add it to the delete list
        usersToDelete.push(user._id);
        cronLogger.info(
          `User ${user.username} has been added to the delete list duo location not being in jordan`
        );
      }
    } catch (error) {
      if (error.errors[0].type == "NOT_FOUND") {
        octokitLogger.error(`The user ${user.username} was not found`);
        // If the user was not found in github add it to the delete list
        usersToDelete.push(user._id);
        cronLogger.info(
          "User has been added to the delete list duo not being found"
        );
      } else {
        octokitLogger.error(error);
        throw err;
      }
    }
  }
  try {
    // Delete all the users in the delete list in one single query
    await User.deleteMany({
      _id: {
        $in: usersToDelete,
      },
    });
    cronLogger.info(
      `Users with those ids have been deleted : ${usersToDelete}`
    );
  } catch (error) {
    dbLogger.error("Could not delete users: ", error);
  }
  cronLogger.info("Database cleanup finished...");
};

const GetUserCommitContributionFromDB = async _username => {
  let user = await User.findOne(
    { username: _username },
    "commit_contributions"
  );
  let userCommits = user.commit_contributions;
  return userCommits;
};

const ExtractContributionsForUser = async (
  _user,
  _firstDayOfLastYear,
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
        contributionsCollection {
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
      octokitLogger.error(`The user ${_user.username} was not found`);
      await User.deleteOne({ username: _user.username });
    } else {
      octokitLogger.error(err);
      throw err;
    }
  }
};

const GetUserIssueContributionFromDB = async _user => {
  let user = await User.findOne({ username: _user }, "issue_contributions");
  let userIssues = user?.issue_contributions;
  if (userIssues) {
    return userIssues;
  } else {
    return [];
  }
};

const GetUserPrContributionFromDB = async _username => {
  let user = await User.findOne({ username: _username }, "pr_contributions");
  let userPrs = user?.pr_contributions;
  if (userPrs) {
    return userPrs;
  } else {
    return [];
  }
};

const extractPrContributionForUser = async _user => {
  let prContributions = await GetUserPrContributionFromDB(_user.username);

  let pullRequests = [];
  let newResult = {
    repositoryName: "",
    starsCount: 0,
    url: "",
    pullRequests: pullRequests,
  };

  try {
    let response = await octokit.graphql(`
      {
        user(login: "${_user.username}") {
          contributionsCollection {
            pullRequestContributionsByRepository {
              contributions(first: 100) {
                nodes {
                  occurredAt
                  pullRequest {
                    repository {
                      id
                      name
                      isPrivate
                      stargazerCount
                      url
                    }
                  }
                }
              }
            }
          }
        }
      }`);

    let data =
      response.user.contributionsCollection
        .pullRequestContributionsByRepository;

    for (const contribution of data) {
      let nodes = contribution.contributions.nodes;
      for (const node of nodes) {
        if (!node.pullRequest.repository.isPrivate) {
          let prObj = {
            occurredAt: node.occurredAt,
          };
          newResult = {
            repositoryName: node.pullRequest.repository.name,
            starsCount: node.pullRequest.repository.stargazerCount,
            url: node.pullRequest.repository.url,
            pullRequests: [...pullRequests, prObj],
          };
          if (!isRepoBlocked(newResult.repositoryName)) {
            let repositoryExists = prContributions.some(
              x => x.url === newResult.url
            );
            if (repositoryExists) {
              let objToUpdate = prContributions.find(
                element => element.url === newResult.url
              );

              let prExists = objToUpdate.pullRequests.some(
                x => x.occurredAt == node.occurredAt
              );

              objToUpdate["starsCount"] =
                node.pullRequest.repository.stargazerCount;
              if (!prExists) {
                objToUpdate.pullRequests = [...objToUpdate.pullRequests, prObj];
              }
            } else {
              prContributions.push(newResult);
            }
          }
        }
      }
    }
    return prContributions;
  } catch (error) {
    if (error.errors[0].type == "NOT_FOUND") {
      octokitLogger.error(`The user ${_user.username} was not found`);
      await User.deleteOne({ username: _user.username });
    } else {
      octokitLogger.error(error);
      throw error;
    }
  }
};

const GetUserCodeReviewContributionFromDB = async _username => {
  let user = await User.findOne(
    { username: _username },
    "code_review_contributions"
  );
  let userCodeReviews = user?.code_review_contributions;
  if (userCodeReviews) {
    return userCodeReviews;
  } else {
    return [];
  }
};

const extractCodeReviewContributionForUser = async _user => {
  let codeReviewContributions = await GetUserCodeReviewContributionFromDB(
    _user.username
  );
  let codeReviews = [];
  let newResult = {
    repositoryName: "",
    starsCount: 0,
    url: "",
    codeReviews: codeReviews,
  };

  try {
    let response = await octokit.graphql(`
      {
        user(login: "${_user.username}") {
          contributionsCollection {
            pullRequestReviewContributionsByRepository {
              contributions(first: 100) {
                nodes {
                  occurredAt
                  repository {
                    id
                    name
                    isPrivate
                    stargazerCount
                    url
                  }
                }
              }
            }
          }
        }
      }`);

    let data =
      response.user.contributionsCollection
        .pullRequestReviewContributionsByRepository;

    for (const contribution of data) {
      let nodes = contribution.contributions.nodes;
      for (const node of nodes) {
        if (!node.repository.isPrivate) {
          let codeReviewObj = {
            occurredAt: node.occurredAt,
          };
          newResult = {
            repositoryName: node.repository.name,
            starsCount: node.repository.stargazerCount,
            url: node.repository.url,
            codeReviews: [...codeReviews, codeReviewObj],
          };
          if (!isRepoBlocked(newResult.repositoryName)) {
            let repositoryExists = codeReviewContributions.some(
              x => x.url === newResult.url
            );
            if (repositoryExists) {
              let objToUpdate = codeReviewContributions.find(
                element => element.url === newResult.url
              );

              let prExists = objToUpdate.codeReviews.some(
                x => x.occurredAt == node.occurredAt
              );

              objToUpdate["starsCount"] = node.repository.stargazerCount;
              if (!prExists) {
                objToUpdate.codeReviews = [
                  ...objToUpdate.codeReviews,
                  codeReviewObj,
                ];
              }
            } else {
              codeReviewContributions.push(newResult);
            }
          }
        }
      }
    }
    return codeReviewContributions;
  } catch (error) {
    if (error.errors[0].type == "NOT_FOUND") {
      octokitLogger.error(`The user ${_user.username} was not found`);
      await User.deleteOne({ username: _user.username });
    } else {
      octokitLogger.error(error);
      throw error;
    }
  }
};

const extractIssuesContributionsForUser = async _user => {
  let issuesContributions = await GetUserIssueContributionFromDB(
    _user.username
  );
  let endCursor = null;
  let hasNextPage = true;
  let issues = [];
  let newResult = {
    repositoryName: "",
    starsCount: 0,
    url: "",
    issues: issues,
  };

  while (hasNextPage) {
    try {
      let pageCursor = endCursor === null ? `${endCursor}` : `"${endCursor}"`;
      let response = await octokit.graphql(`{
          user(login: "${_user.username}") {
            contributionsCollection {
              issueContributions(first: 100, after: ${pageCursor}) {
                nodes {
                  occurredAt
                  issue {
                    repository {
                      id
                      name
                      stargazerCount
                      isPrivate
                      url
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }`);
      let data = response.user.contributionsCollection.issueContributions.nodes;
      for (const contribution of data) {
        const issue = contribution.issue;
        if (!issue.repository.isPrivate) {
          let IssueObj = {
            occurredAt: contribution.occurredAt,
          };
          newResult = {
            repositoryName: issue.repository.name,
            starsCount: issue.repository.stargazerCount,
            url: issue.repository.url,
            issues: [...issues, IssueObj],
          };
          if (!isRepoBlocked(newResult.repositoryName)) {
            let repositoryExists = issuesContributions.some(
              x => x.url === issue.repository.url
            );
            if (repositoryExists) {
              let objToUpdate = issuesContributions.find(
                element => element.url === issue.repository.url
              );
              let issueExists = objToUpdate.issues.some(
                x => x.occurredAt == contribution.occurredAt
              );

              objToUpdate["starsCount"] = issue.repository.stargazerCount;
              if (!issueExists) {
                objToUpdate.issues = [...objToUpdate.issues, IssueObj];
              }
            } else {
              issuesContributions.push(newResult);
            }
          }
        }
      }
      endCursor =
        response.user.contributionsCollection.issueContributions.pageInfo
          .endCursor;
      hasNextPage =
        response.user.contributionsCollection.issueContributions.pageInfo
          .hasNextPage;
    } catch (error) {
      if (error.errors[0].type == "NOT_FOUND") {
        octokitLogger.error(`The user ${_user.username} was not found`);
        await User.deleteOne({ username: _user.username });
        hasNextPage = false;
      } else {
        octokitLogger.error(error);
        throw err;
      }
    }
  }
  return issuesContributions;
};

const SaveUserContributionsToDB = async () => {
  const retries = 2;
  const wait = 3600000;
  let firstDayOfLastYear = `${
    new Date().getFullYear() - 1
  }-01-01T00:00:00.000Z`;
  let dateNow = new Date().toISOString();
  let users = await GetUsersFromDB({}, "username");
  for (const user of users) {
    try {
      let userCommits = await retryPromiseWithDelay(
        ExtractContributionsForUser(user, firstDayOfLastYear, dateNow),
        retries,
        wait
      );
      let userIssues = await extractIssuesContributionsForUser(user);
      let userPullRequests = await extractPrContributionForUser(user);
      let userCodeReviews = await extractCodeReviewContributionForUser(user);

      await User.updateOne(
        { username: user.username },
        {
          commit_contributions: userCommits,
          issue_contributions: userIssues,
          pr_contributions: userPullRequests,
          code_review_contributions: userCodeReviews,
        }
      );
      if (process.env.NODE_ENV !== "production") {
        cronLogger.info(`User: ${user.username}, Contributions Updated`);
      }
    } catch (err) {
      dbLogger.error(`Could not update ${user.username} contributions: ${err}`);
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
        avatar_url: org.avatarUrl,
        name: org.name,
        location: org.location,
        github_profile_url: org.url,
        organization_createdAt: org.createdAt,
      });
      await newOrg.save();
      if (process.env.NODE_ENV !== "production") {
        dbLogger.info(
          `Organization: ${newOrg.username} and the location is ${newOrg.location} was saved to DB`
        );
      }
    } else {
      if (process.env.NODE_ENV !== "production") {
        dbLogger.error(`Organization: ${org.login} Exists`);
      }
    }
  }
};

const GetOrganizationRepoFromDB = async _organization => {
  let org = await Organization.findOne(
    { username: _organization },
    "repositories"
  );
  let orgRepos = org.repositories;
  return orgRepos;
};

const SaveOrganizationsRepositoriesToDB = async () => {
  let organizations = await Organization.find({}, "username");
  for (const org of organizations) {
    try {
      let orgRepos = await ExtractOrganizationRepositoriesFromGithub(org);

      await Organization.updateOne(
        { username: org.username },
        { repositories: orgRepos }
      );
      if (process.env.NODE_ENV !== "production") {
        dbLogger.info(`Organization: ${org.username}, Repositories Added`);
      }
    } catch (err) {
      dbLogger.error(`Could not update ${org.username} repositories: ${err}`);
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
  let extractedOrganizations = [];
  for (let index = 0; index < locationsToSearch.length; index++) {
    let endCursor = null;
    let hasNextPage = true;
    while (hasNextPage) {
      let pageCursor = endCursor === null ? `${endCursor}` : `"${endCursor}"`;
      let result = await octokit.graphql(
        `{
          search(query: "location:${locationsToSearch[index]} type:org", type: USER, first: 100, after: ${pageCursor}) {
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
      }`
      );
      let newOrg = await result.search.nodes;
      for (const org of newOrg) {
        if (isInJordan(org.location)) {
          extractedOrganizations = [...extractedOrganizations, org];
        }
      }
      hasNextPage = await result.search.pageInfo.hasNextPage;
      endCursor = await result.search.pageInfo.endCursor;
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
    } catch (err) {
      if (err.errors[0].type == "NOT_FOUND") {
        octokitLogger.error(
          `The organization ${_organization.username} was not found`
        );
        await Organization.deleteOne({ username: _organization.username });
        // if the request failed exit the loop
        hasNextPage = false;
      } else {
        octokitLogger.error(err);
        throw err;
      }
    }
  }
  return organizationRepositories;
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
      dbLogger.error(`The organization ${_orgUsername} was not found`);
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
      octokitLogger.error(`The organization ${_orgUsername} was not found`);
      await Organization.deleteOne({ username: _orgUsername });
    }
  }
};

const UpdateOrganizationsMembers = async () => {
  const orgs = await Organization.find({}, "username");
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
  cronLogger.info("Started Syncing Organizations");
  cronLogger.info("Started extracting organizations");
  await ExtractOrganizationsFromGithub();
  cronLogger.info("Finished extracting organizations");
  cronLogger.info("Syncing organizations repositories...");
  await SaveOrganizationsRepositoriesToDB();
  cronLogger.info("Finished syncing organizations repositories");
  // await UpdateOrganizationsInfo();
  cronLogger.info("Syncing organizations members...");
  await UpdateOrganizationsMembers();
  cronLogger.info("Finished syncing organizations members...");
  cronLogger.info("Finished Syncing Organizations");
};

const SyncUsers = async () => {
  cronLogger.info("Started Syncing Users");
  cronLogger.info("Started extracting Users");
  await ExtractUsersFromGithub();
  cronLogger.info("Finished extracting Users");
  cronLogger.info("Syncing users contributions ...");
  await SaveUserContributionsToDB();
  await CalculateUserTotalCommitsByRepo();
  cronLogger.info("Finished Syncing users contributions");
  cronLogger.info("Finished Syncing Users");
};

const CalculateScore = async () => {
  cronLogger.info("Started Calculating Score");
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
      cronLogger.info(`User: ${user.name}, score calculated: ${score}`);
    }
  }
  cronLogger.info("Finished Calculating Score");
};

const CalculateRepositoriesNumberForOrgs = async () => {
  cronLogger.info(
    "Started Calculating Repositories Number For The Organizations"
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
      cronLogger.info(
        `Org: ${org.username}, repositories Number: ${numberOfRepositories}`
      );
    }
  }
  cronLogger.info(
    "Finished Calculating Repositories Number For The Organizations"
  );
};

const CalculateCommitsCountForUsers = async () => {
  cronLogger.info("Started Calculating Commits Count For The Users");
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
      cronLogger.info(
        `User: ${user.username}, user commits Count: ${userCommitsCount}`
      );
    }
  }
  cronLogger.info("Finished Calculating Commits Count For The Users");
};

const RankUsersByScore = _usersArray => {
  cronLogger.info("Cron Started Ranking Users By Score");
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

  cronLogger.info("Cron Finished Ranking Users By Score");
  return userRanks;
};

const RankUsersByContributions = _usersArray => {
  cronLogger.info("Cron Started Ranking Users By Contributions");
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

  cronLogger.info("Cron Finished Ranking Users By Contributions");
  return userRanks;
};

const UpdateUsersScoreRanks = async () => {
  cronLogger.info("Started Updating Users Score Ranks");
  let users = await User.find({}, "username score").sort({
    score: -1,
    _id: 1,
  });
  const usersRankedByScore = RankUsersByScore(users);

  for (const element of usersRankedByScore) {
    const doc = await User.findOne({ username: element.user.username });
    doc.score_rank = element.currentRank;
    const saved = await doc.save();

    if (process.env.NODE_ENV !== "production") {
      if (saved) {
        cronLogger.info(`User ${element.user.username} Got Saved`);
      }
    }
  }
  cronLogger.info("Finished Updating Users Score Ranks");
};

const UpdateUsersContributionsRanks = async () => {
  cronLogger.info("Started Updating Users Contributions Ranks");
  let users = await User.find({}, "username commitsTotalCount").sort({
    commitsTotalCount: -1,
    _id: 1,
  });
  const usersRankedByContributions = RankUsersByContributions(users);

  for (const element of usersRankedByContributions) {
    const doc = await User.findOne({ username: element.user.username });
    doc.contributions_rank = element.currentRank;
    const saved = await doc.save();

    if (process.env.NODE_ENV !== "production") {
      if (saved) {
        cronLogger.info(`User ${element.user.username} Got Saved`);
      }
    }
  }
  cronLogger.info("Finished Updating Users Contributions Ranks");
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

const CalculateUserTotalCommitsByRepo = async () => {
  let users = await GetUsersFromDB({}, {});
  for (const user of users) {
    if (process.env.NODE_ENV === "development")
      dbLogger.info(`Started updating user: ${user.username}`);
    const userCommits = await GetUserCommitContributionFromDB(user.username);
    const updatedCommitContributions = [];
    for (const repo of userCommits) {
      repoTotalCommits = 0;
      for (const commit of repo.commits) {
        repoTotalCommits += commit.commitCount;
      }
      const newRepoObject = {
        ...repo,
        totalCommits: repoTotalCommits,
      };
      updatedCommitContributions.push(newRepoObject);
    }
    // Sort the repos by total commits
    const sortedContributions = updatedCommitContributions
      .slice()
      .sort((a, b) => {
        return b.totalCommits - a.totalCommits;
      });

    await User.updateOne(
      { username: user.username },
      { commit_contributions: sortedContributions }
    );
    if (process.env.NODE_ENV === "development")
      dbLogger.info(`Finished updating user: ${user.username}`);
  }
};

const CreateStats = async () => {
  cronLogger.info("Creating Stats...");
  let commitsCount = 0;
  let commitsList = [];
  const usersCount = await User.countDocuments({});
  const orgsCount = await Organization.countDocuments({});
  const users = await User.find({}, "commit_contributions");
  for (const user of users) {
    for (const repo of user.commit_contributions) {
      for (const commit of repo.commits) {
        commitsList.push(commit);
      }
    }
  }
  for (const contribution of commitsList) {
    commitsCount += contribution.commitCount;
  }
  let newStats = new Stat({
    total_users: usersCount,
    total_orgs: orgsCount,
    total_commits: commitsCount,
  });
  await newStats.save();
  cronLogger.info("Finished creating Stats");
};

async function main() {
  await ConnectToDB();

  // Should the cron job sync-users, sync-orgs or just do a cleanup
  const runMode = process.env.RUN_MODE;
  switch (runMode.toLowerCase()) {
    case "sync-users":
      await SyncUsers();
      break;
    case "sync-orgs":
      await SyncOrganizations();
      break;
    case "cleanup":
      await CleanDatabase();
      break;
    default:
      break;
  }
  await CalculateScore();
  await CalculateCommitsCountForUsers();
  await CalculateRepositoriesNumberForOrgs();
  await UpdateUsersRanks();
  await CreateStats();

  await mongoose.connection.close();
  dbLogger.info(
    "Mongoose default connection with DB is disconnected, the job is finished."
  );
  process.exit(0); // program will exit successfully
}

main();

// listen for uncaught exceptions events
process.on("uncaughtException", async err => {
  await mongoose.connection.close(); // close the database connection before exiting
  cronLogger.error(err); // logging the uncaught error
  process.exit(1); // exit with failure
});
