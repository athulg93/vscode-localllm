import test from 'node:test';
import assert from 'node:assert/strict';
import { GitErrorDiagnoser } from './GitErrorDiagnoser';

test('diagnoses non-fast-forward push rejection', () => {
  const rawError = `
To https://github.com/athulg93/my-repo.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'https://github.com/athulg93/my-repo.git'
hint: Updates were rejected because the remote contains work that you do
hint: not have locally. This is usually caused by another repository pushing
hint: to the same ref. You may want to first integrate the remote changes
hint: (e.g., 'git pull ...') before pushing again.
`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_push', rawError, { remote: 'origin', branch: 'main' });

  assert.equal(diagnosis.category, 'PUSH_REJECTED_NON_FAST_FORWARD');
  assert.equal(diagnosis.isFatal, false);
  assert.ok(diagnosis.summary.includes('new commits that are not present locally'));
  assert.ok(diagnosis.suggestedSteps.some((s) => s.toolCall?.name === 'git_pull'));
  assert.ok(diagnosis.suggestedSteps.some((s) => s.toolCall?.name === 'git_stash'));
  assert.ok(diagnosis.suggestedSteps.some((s) => s.toolCall?.name === 'git_push'));
  assert.ok(diagnosis.agentGuidance.includes('NEVER execute a force push'));
  assert.ok(diagnosis.suggestedUserQuestion.includes('pull the latest changes'));
});

test('diagnoses local changes overwritten by merge (file overlap scenario)', () => {
  const rawError = `
error: Your local changes to the following files would be overwritten by merge:
\tsrc/App.tsx
\tpackage.json
\tsrc/components/Header.tsx
Please commit your changes or stash them before you merge.
Aborting
`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_pull', rawError, { remote: 'origin', branch: 'main' });

  assert.equal(diagnosis.category, 'LOCAL_CHANGES_OVERWRITTEN');
  assert.equal(diagnosis.isFatal, false);
  assert.deepEqual(diagnosis.affectedFiles, [
    'src/App.tsx',
    'package.json',
    'src/components/Header.tsx',
  ]);
  assert.ok(diagnosis.summary.includes('3 file(s)'));
  assert.ok(diagnosis.suggestedSteps[0].toolCall?.name === 'git_stash');
  assert.ok(diagnosis.suggestedSteps[0].toolCall?.arguments.action === 'push');
  assert.ok(diagnosis.suggestedSteps[1].toolCall?.name === 'git_pull');
  assert.ok(diagnosis.suggestedSteps[2].toolCall?.name === 'git_stash');
  assert.ok(diagnosis.suggestedSteps[2].toolCall?.arguments.action === 'pop');
  assert.ok(diagnosis.suggestedUserQuestion.includes('stash your changes'));
});

test('diagnoses untracked files overwritten by checkout', () => {
  const rawError = `
error: The following untracked working tree files would be overwritten by checkout:
\tbuild/bundle.js
Please move or remove them before you switch branches.
Aborting
`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_checkout', rawError, { branch: 'feature' });

  assert.equal(diagnosis.category, 'LOCAL_CHANGES_OVERWRITTEN');
  assert.deepEqual(diagnosis.affectedFiles, ['build/bundle.js']);
  assert.ok(diagnosis.suggestedSteps.some((s) => s.toolCall?.name === 'git_stash'));
});

test('diagnoses merge conflicts and extracts conflicted files', () => {
  const rawError = `
Auto-merging src/index.ts
CONFLICT (content): Merge conflict in src/index.ts
Auto-merging README.md
CONFLICT (content): Merge conflict in README.md
Automatic merge failed; fix conflicts and then commit the result.
`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_merge', rawError, { branch: 'develop' });

  assert.equal(diagnosis.category, 'MERGE_CONFLICT');
  assert.equal(diagnosis.isFatal, false);
  assert.deepEqual(diagnosis.affectedFiles, ['src/index.ts', 'README.md']);
  assert.ok(diagnosis.suggestedSteps.some((s) => s.description.includes('conflict markers')));
  assert.ok(diagnosis.suggestedSteps.some((s) => s.toolCall?.name === 'git_add'));
  assert.ok(diagnosis.suggestedSteps.some((s) => s.toolCall?.name === 'git_commit'));
});

test('diagnoses no upstream branch configured', () => {
  const rawError = `
fatal: The current branch feature-v1 has no upstream branch.
To push the current branch and set the remote as upstream, use

    git push --set-upstream origin feature-v1
`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_push', rawError, {});

  assert.equal(diagnosis.category, 'NO_UPSTREAM_BRANCH');
  assert.equal(diagnosis.isFatal, false);
  assert.ok(diagnosis.summary.includes('feature-v1'));
  assert.equal(diagnosis.suggestedSteps[0].toolCall?.arguments.setUpstream, true);
  assert.equal(diagnosis.suggestedSteps[0].toolCall?.arguments.branch, 'feature-v1');
  assert.equal(diagnosis.suggestedSteps[0].toolCall?.arguments.remote, 'origin');
});

test('diagnoses uncommitted changes blocking rebase', () => {
  const rawError = `
error: cannot pull with rebase: You have unstaged changes.
error: Please commit or stash them.
`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_pull', rawError, {});

  assert.equal(diagnosis.category, 'UNCOMMITTED_CHANGES');
  assert.ok(diagnosis.suggestedSteps.some((s) => s.toolCall?.name === 'git_status'));
  assert.ok(diagnosis.suggestedSteps.some((s) => s.toolCall?.name === 'git_stash'));
});

test('diagnoses index.lock conflict', () => {
  const rawError = `
fatal: Unable to create '/path/to/.git/index.lock': File exists.

Another git process seems to be running in this repository, e.g.
an editor opened by 'git commit'. Please make sure all processes
are terminated then try again.
`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_commit', rawError, {});

  assert.equal(diagnosis.category, 'INDEX_LOCK');
  assert.deepEqual(diagnosis.affectedFiles, ['.git/index.lock']);
  assert.ok(diagnosis.summary.includes('index.lock'));
});

test('diagnoses authentication failure', () => {
  const rawError = `
fatal: Authentication failed for 'https://github.com/athulg93/private-repo.git'
remote: Invalid username or password.
`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_push', rawError, {});

  assert.equal(diagnosis.category, 'AUTHENTICATION_FAILED');
  assert.equal(diagnosis.isFatal, true);
  assert.ok(diagnosis.agentGuidance.includes('Never ask the user to type passwords'));
});

test('diagnoses remote repository not found', () => {
  const rawError = `fatal: 'nonexistent-remote' does not appear to be a git repository`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_pull', rawError, { remote: 'nonexistent-remote' });

  assert.equal(diagnosis.category, 'REMOTE_NOT_FOUND');
  assert.ok(diagnosis.suggestedSteps.some((s) => s.toolCall?.name === 'git_remote'));
});

test('diagnoses branch not found', () => {
  const rawError = `error: pathspec 'feature-xyz' did not match any file(s) known to git`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_checkout', rawError, { branch: 'feature-xyz' });

  assert.equal(diagnosis.category, 'BRANCH_NOT_FOUND');
  assert.ok(diagnosis.suggestedSteps.some((s) => s.toolCall?.name === 'git_branch'));
});

test('diagnoses not a git repository', () => {
  const rawError = `fatal: not a git repository (or any of the parent directories): .git`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_status', rawError, {});

  assert.equal(diagnosis.category, 'NOT_A_GIT_REPOSITORY');
  assert.equal(diagnosis.isFatal, true);
});

test('diagnoses nothing to commit', () => {
  const rawError = `On branch main\nnothing to commit, working tree clean`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_commit', rawError, { message: 'test' });

  assert.equal(diagnosis.category, 'NOTHING_TO_COMMIT');
  assert.ok(diagnosis.suggestedSteps.some((s) => s.toolCall?.name === 'git_status'));
});

test('diagnoses empty stash', () => {
  const rawError = `No stash entries found.`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_stash', rawError, { action: 'pop' });

  assert.equal(diagnosis.category, 'STASH_EMPTY');
});

test('formats diagnostic report in clean markdown', () => {
  const rawError = `
error: Your local changes to the following files would be overwritten by merge:
\tsrc/App.tsx
Please commit your changes or stash them before you merge.
`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_pull', rawError, {});
  const report = GitErrorDiagnoser.formatDiagnosticReport(diagnosis);

  assert.ok(report.includes('### ⚠️ Git Operation Issue:'));
  assert.ok(report.includes('`src/App.tsx`'));
  assert.ok(report.includes('Recommended Next Steps:'));
  assert.ok(report.includes('💡 **Suggested Action:**'));
});

test('diagnoses GitLab protected branch push rejection with MR guidance', () => {
  const rawError = `
remote: GitLab: You are not allowed to push code to protected branches on this project.
remote: 
remote: View merge request for feature/update:
remote:   https://gitlab.com/company/repo/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Fupdate
To https://gitlab.com/company/repo.git
 ! [remote rejected] main -> main (pre-receive hook declined)
`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_push', rawError, { remote: 'origin', branch: 'main' });

  assert.equal(diagnosis.category, 'GITLAB_PROTECTED_BRANCH');
  assert.equal(diagnosis.isFatal, false);
  assert.ok(diagnosis.summary.includes('main'));
  assert.ok(diagnosis.suggestedSteps.some((s) => s.toolCall?.name === 'git_checkout'));
  assert.ok(diagnosis.suggestedSteps.some((s) => s.description.includes('https://gitlab.com/company/repo/-/merge_requests')));
  assert.ok(diagnosis.agentGuidance.includes('NEVER attempt a force-push to a protected GitLab branch'));
});

test('diagnoses GitLab push rule pre-receive hook rejection', () => {
  const rawError = `
remote: GL-HOOK-ERR: Commit message does not follow the pattern: /^[A-Z]+-[0-9]+: .+/
remote: GitLab: Commit message does not follow the pattern
To https://gitlab.com/team/core.git
 ! [remote rejected] main -> main (pre-receive hook declined)
`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_push', rawError, { remote: 'origin', branch: 'main' });

  assert.equal(diagnosis.category, 'GITLAB_PUSH_RULE');
  assert.equal(diagnosis.isFatal, false);
  assert.ok(diagnosis.suggestedSteps.some((s) => s.description.includes('git commit --amend')));
});

test('diagnoses GitLab 2FA personal access token authentication requirement', () => {
  const rawError = `
remote: HTTP Basic: Access denied. The provided password or token is incorrect or your account has 2FA enabled -- you must use a personal access token instead of a password.
fatal: Authentication failed for 'https://gitlab.com/org/project.git/'
`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_push', rawError, {});

  assert.equal(diagnosis.category, 'GITLAB_AUTH_2FA');
  assert.equal(diagnosis.isFatal, true);
  assert.ok(diagnosis.explanation.includes('Personal Access Token (PAT)'));
  assert.ok(diagnosis.suggestedSteps.some((s) => s.description.includes('write_repository')));
});

test('diagnoses GitLab repository storage quota limit', () => {
  const rawError = `
remote: GitLab: Your push has been rejected, because the repository size exceeds the limit of 10240 MB.
remote: Please remove oversized files and use Git LFS.
`;

  const diagnosis = GitErrorDiagnoser.diagnose('git_push', rawError, {});

  assert.equal(diagnosis.category, 'GITLAB_STORAGE_LIMIT');
  assert.equal(diagnosis.isFatal, true);
  assert.ok(diagnosis.suggestedSteps.some((s) => s.description.includes('Git LFS')));
});

