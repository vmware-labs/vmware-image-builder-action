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

 We do use ESLint as a tool to ensure a consistent format. A format check step runs as part of our continuous integration and pull requests get failed checks if they don't adhere to the conventions. To make sure your contribution is properly formatted you can run the following:

 ``` shell
 npm run lint
 ```

 The `format` script can also be used to make ESLint automatically apply the format guidelines:

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

 All stable code is hosted at the `main` branch. Releases are done on demand through the _Release Action_ GitHub workflow. In order to release the current `HEAD`, you will need to trigger this workflow passing the version being released (i.e. `v3.0.2`).

 Once triggered, the workflow will put the specified version on the `package.json` and `package-lock.json`, generate a release commit and tag, and roll the corresponding major. Then, all of that will be pushed back to GitHub. This mechanism lets users:

* Stay synced with the main branch (`@main`)
* Select a specific major train (`@v1`)
* Pin a specific release (`@v1.2.3`)

 ## Promotion Process

 Upon any major release and sometimes with minor releases that might be needed by customers we will be promoting our releases to the GitHub Marketplace. Unfortunately, GitHub is not providing any automation for publishing GitHub Actions into their marketplace so this will essentially be a manual process until automation support is provided by their platform.

## Reporting Bugs and Creating Issues

When opening a new issue, try to roughly follow the commit message format conventions above.
