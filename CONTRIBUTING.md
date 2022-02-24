# Contributing to vmware-image-builder-action

The vmware-image-builder-action project team welcomes contributions from the community. Before you start working with vmware-image-builder-action, please
read our [Developer Certificate of Origin](https://cla.vmware.com/dco). All contributions to this repository must be
signed as described on that page. Your signature certifies that you wrote the patch or have the right to pass it on
as an open-source patch.

## Contribution Flow

This is a rough outline of what a contributor's workflow looks like:

- Create a topic branch from where you want to base your work
- Make commits of logical units
- Make sure your commit messages are in the proper format (see below)
- Push your changes to a topic branch in your fork of the repository
- Submit a pull request

Example:

``` shell
git remote add upstream https://github.com/vmware-labs/vmware-image-builder-action.git
git checkout -b my-new-feature main
git commit -a
git push origin my-new-feature
```

### Staying In Sync With Upstream

When your branch gets out of sync with the vmware-labs/main branch, use the following to update:

``` shell
git checkout my-new-feature
git fetch -a
git pull --rebase upstream main
git push --force-with-lease origin my-new-feature
```

### Updating pull requests

If your PR fails to pass CI or needs changes based on code review, you'll most likely want to squash these changes into
existing commits.

If your pull request contains a single commit or your changes are related to the most recent commit, you can simply
amend the commit.

``` shell
git add .
git commit --amend
git push --force-with-lease origin my-new-feature
```

If you need to squash changes into an earlier commit, you can use:

``` shell
git add .
git commit --fixup <commit>
git rebase -i --autosquash main
git push --force-with-lease origin my-new-feature
```

Be sure to add a comment to the PR indicating your new changes are ready to review, as GitHub does not generate a
notification when you git push.

### Code Style

### Formatting Commit Messages

We follow the conventions on [How to Write a Git Commit Message](http://chris.beams.io/posts/git-commit/).

Be sure to include any related GitHub issue references in the commit message.  See
[GFM syntax](https://guides.github.com/features/mastering-markdown/#GitHub-flavored-markdown) for referencing issues
and commits.

### Formatting Code

 We do use Prettier as a tool to ensure a consistent format. A format check step runs as part of our continuous integration and pull requests get failed checks if they don't adhere to the conventions. To make sure your contribution is properly formatted you can run the following:

 ``` shell
 npm run format-check
 ```

 The `format` script can also be used to make prettier automatically apply the format guidelines:

 ``` shell
 npm run format
 ```

 ### Static Analysis

 As part of our continuous integration workflow we do pass ESlint to all pull requests. To make sure that your contribution passes all the static checks you can use:

 ``` shell
 npm run lint
 ```

 ### Tests

 We value highly-tested software. All pull requests should come accompanied by corresponding unit tests. Integration tests are also welcomed. To make sure that your contribution isn't causing any regression we run the test suite as part of our continuous integration process. You should also make sure that all the tests pass before sending your pull request:

 ``` shell
 npm run test
 ```

 ## Release Process

 All stable code is hosted at the `main` branch. Release and version management is fully automated and based in commit messages that follow a subset of the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) spec. Based on the commit message, our continuous integration pipeline will automatically build, package and version bump and tag the codebase. 

 Versioning follows the [semver](https://semver.org) spec and the appropriate patch, minor or major version is bumped depending on the commit messages. Here is the convention used for version bumping based on the commit messages:

 * If the strings "BREAKING CHANGE", "major" are found anywhere in any of the commit messages or descriptions the major version will be incremented.
 * If a commit message begins with the string "feat" or includes "minor" then the minor version will be increased. This works for most common commit metadata for feature additions: "feat: new API" and "feature: new API".
 * All other changes will increment the patch version.

 Once version is bumped in package.json and package-lock.json files, these files will be pushed into repository. The a new tag will be pushed for the new version back into the repo.

 In addition to version bumping, our continuous integration script will build and package the GitHub Action before pushing the changes to the main branch.

 ## Promotion Process

 Upon any major release and sometimes with minor releases that might be needed by customers we will be promoting our releases to 
 the GitHub Marketplace. Unfortunately, GitHub is not providing any automation for publishing GitHub Actions into their marketplace 
 so this will essentially be a manual process until automation support is provided by their platform.

## Reporting Bugs and Creating Issues

When opening a new issue, try to roughly follow the commit message format conventions above.
