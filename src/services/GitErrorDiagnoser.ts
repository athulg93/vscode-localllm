export type GitErrorCategory =
  | 'PUSH_REJECTED_NON_FAST_FORWARD'
  | 'LOCAL_CHANGES_OVERWRITTEN'
  | 'MERGE_CONFLICT'
  | 'NO_UPSTREAM_BRANCH'
  | 'UNCOMMITTED_CHANGES'
  | 'DETACHED_HEAD'
  | 'INDEX_LOCK'
  | 'AUTHENTICATION_FAILED'
  | 'REMOTE_NOT_FOUND'
  | 'BRANCH_NOT_FOUND'
  | 'NOT_A_GIT_REPOSITORY'
  | 'NOTHING_TO_COMMIT'
  | 'STASH_EMPTY'
  | 'GITLAB_PROTECTED_BRANCH'
  | 'GITLAB_PUSH_RULE'
  | 'GITLAB_AUTH_2FA'
  | 'GITLAB_STORAGE_LIMIT'
  | 'UNKNOWN_GIT_ERROR';

export interface GitRemediationStep {
  step: number;
  description: string;
  toolCall?: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface GitDiagnosis {
  category: GitErrorCategory;
  summary: string;
  rawError: string;
  affectedFiles: string[];
  explanation: string;
  suggestedSteps: GitRemediationStep[];
  remediationPrompt: string;
  suggestedUserQuestion: string;
  agentGuidance: string;
  isFatal: boolean;
}

export class GitErrorDiagnoser {
  /**
   * Diagnoses any Git CLI error string into structured, model-actionable intelligence.
   */
  static diagnose(
    commandName: string,
    rawError: string,
    commandArgs: Record<string, unknown> = {}
  ): GitDiagnosis {
    const errorText = rawError.trim();

    // GitLab Protected Branch rejection
    if (
      /remote:\s*GitLab:\s*You are not allowed to (?:force )?push code to protected branches/i.test(errorText) ||
      /remote:\s*GitLab:\s*You are not allowed to push code to this project/i.test(errorText) ||
      /remote:\s*GitLab:\s*A default branch cannot be deleted/i.test(errorText)
    ) {
      return this.diagnoseGitLabProtectedBranch(errorText, commandArgs);
    }

    // GitLab Push Rule or Pre-Receive Hook rejection
    if (
      /remote:\s*GitLab:\s*Commit message does not follow/i.test(errorText) ||
      /remote:\s*GitLab:\s*Author '.*' is not a member of team/i.test(errorText) ||
      /remote:\s*GitLab:\s*Author '.*' does not match/i.test(errorText) ||
      /remote:\s*GL-HOOK-ERR:/i.test(errorText) ||
      /remote:\s*GitLab:\s*(?:Push rejected|Secret detection found|Pipeline must succeed)/i.test(errorText)
    ) {
      return this.diagnoseGitLabPushRule(errorText, commandArgs);
    }

    // GitLab 2FA / Personal Access Token requirement
    if (
      /remote:\s*HTTP Basic:\s*Access denied.*(?:2FA|Personal Access Token)/i.test(errorText) ||
      /remote:\s*You must use a personal access token with 'write_repository'/i.test(errorText)
    ) {
      return this.diagnoseGitLabAuth2FA(errorText);
    }

    // GitLab storage quota or file size limit
    if (
      /remote:\s*GitLab:\s*Your push has been rejected, because the repository size exceeds/i.test(errorText) ||
      /remote:\s*GitLab:\s*File .* exceeds maximum file size/i.test(errorText)
    ) {
      return this.diagnoseGitLabStorageLimit(errorText);
    }

    // 1. Push rejected / non-fast-forward / remote contains work
    if (
      /\[rejected\]/i.test(errorText) ||
      /non-fast-forward/i.test(errorText) ||
      /fetch first/i.test(errorText) ||
      /remote contains work that you do\s*not have locally/i.test(errorText) ||
      /Updates were rejected because the tip of your current branch is behind/i.test(errorText)
    ) {
      return this.diagnosePushRejected(errorText, commandArgs);
    }

    // 2. Local uncommitted changes would be overwritten by merge, checkout, pull, or rebase
    if (
      /local changes to the following files would be overwritten/i.test(errorText) ||
      /untracked working tree files would be overwritten/i.test(errorText) ||
      /Please commit your changes or stash them before you (?:merge|switch|checkout|rebase)/i.test(errorText)
    ) {
      return this.diagnoseLocalChangesOverwritten(commandName, errorText, commandArgs);
    }

    // 3. Merge conflict or unmerged paths
    if (
      /CONFLICT\s*\([^)]*\):/i.test(errorText) ||
      /Automatic merge failed;\s*fix conflicts/i.test(errorText) ||
      /you need to resolve your current index first/i.test(errorText) ||
      /You have unmerged paths/i.test(errorText) ||
      /fix conflicts and then commit the result/i.test(errorText)
    ) {
      return this.diagnoseMergeConflict(errorText, commandArgs);
    }

    // 4. No upstream branch configured
    if (
      /has no upstream branch/i.test(errorText) ||
      /has no tracking branch/i.test(errorText) ||
      /use\s+git push --set-upstream/i.test(errorText) ||
      /There is no tracking information for the current branch/i.test(errorText)
    ) {
      return this.diagnoseNoUpstreamBranch(errorText, commandArgs);
    }

    // 5. Uncommitted changes blocking rebase or checkout
    if (
      /cannot (?:checkout|pull with rebase|switch)[\s\S]*?(?:unstaged changes|uncommitted changes)/i.test(errorText) ||
      /Please commit or stash them/i.test(errorText)
    ) {
      return this.diagnoseUncommittedChanges(commandName, errorText);
    }

    // 6. Detached HEAD
    if (/You are in 'detached HEAD' state/i.test(errorText) || /HEAD detached at/i.test(errorText)) {
      return this.diagnoseDetachedHead(errorText);
    }

    // 7. Index lock file exists
    if (/Unable to create\s*'[^']*index\.lock'/i.test(errorText) || /Another git process seems to be running/i.test(errorText)) {
      return this.diagnoseIndexLock(errorText);
    }

    // 8. Authentication or permission failures
    if (
      /Authentication failed for/i.test(errorText) ||
      /could not read Username/i.test(errorText) ||
      /Permission denied \(publickey\)/i.test(errorText) ||
      /Invalid username or password/i.test(errorText) ||
      /The requested URL returned error:\s*40[13]/i.test(errorText)
    ) {
      return this.diagnoseAuthFailure(errorText);
    }

    // 9. Remote repository not found or unreachable
    if (
      /does not appear to be a git repository/i.test(errorText) ||
      /Could not read from remote repository/i.test(errorText) ||
      /No such remote\s*'([^']*)'/i.test(errorText)
    ) {
      return this.diagnoseRemoteNotFound(errorText, commandArgs);
    }

    // 10. Branch or path not found
    if (
      /pathspec\s*'([^']*)'\s*did not match any file/i.test(errorText) ||
      /Cannot update paths and switch to branch\s*'([^']*)'/i.test(errorText) ||
      /A branch named\s*'([^']*)'\s*already exists/i.test(errorText)
    ) {
      return this.diagnoseBranchOrPathspecNotFound(errorText);
    }

    // 11. Not a git repository
    if (/not a git repository/i.test(errorText)) {
      return this.diagnoseNotAGitRepo(errorText);
    }

    // 12. Nothing to commit
    if (/nothing to commit/i.test(errorText) || /no changes added to commit/i.test(errorText)) {
      return this.diagnoseNothingToCommit(errorText);
    }

    // 13. Stash empty or invalid
    if (/No stash entries found/i.test(errorText) || /No local changes to save/i.test(errorText)) {
      return this.diagnoseStashEmpty(errorText);
    }

    // Fallback: Generic Git error
    return this.diagnoseGenericError(commandName, errorText, commandArgs);
  }

  private static diagnosePushRejected(rawError: string, commandArgs: Record<string, unknown>): GitDiagnosis {
    const remote = typeof commandArgs.remote === 'string' ? commandArgs.remote : 'origin';
    const branch = typeof commandArgs.branch === 'string' ? commandArgs.branch : '';

    const summary = 'Git push rejected: Remote repository has new commits that are not present locally.';
    const explanation =
      'Your push was declined because another commit was pushed to the remote branch since your last pull. ' +
      'Pushing without integrating those commits would overwrite history.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: `Pull remote changes to integrate with local branch (${remote}${branch ? ` / ${branch}` : ''}).`,
        toolCall: {
          name: 'git_pull',
          arguments: {
            ...(branch ? { branch } : {}),
            ...(remote ? { remote } : {}),
          },
        },
      },
      {
        step: 2,
        description: 'If you have uncommitted changes that collide with incoming commits, stash them before pulling, then pop the stash after.',
        toolCall: {
          name: 'git_stash',
          arguments: { action: 'push', message: 'Auto-stash before sync' },
        },
      },
      {
        step: 3,
        description: 'Once the remote changes are merged or rebased cleanly, re-try git_push.',
        toolCall: {
          name: 'git_push',
          arguments: {
            ...(branch ? { branch } : {}),
            ...(remote ? { remote } : {}),
          },
        },
      },
    ];

    const suggestedUserQuestion =
      `The remote branch contains new commits. Would you like me to pull the latest changes${branch ? ` for ${branch}` : ''} and then push your changes?`;

    const agentGuidance = this.createAgentGuidance({
      category: 'PUSH_REJECTED_NON_FAST_FORWARD',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: [
        'NEVER execute a force push (--force or -f) under any circumstances.',
        'Explain that the remote branch has progressed ahead of the local branch.',
        'Ask the user for permission to pull incoming changes before retrying the push.',
      ],
    });

    return {
      category: 'PUSH_REJECTED_NON_FAST_FORWARD',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseLocalChangesOverwritten(
    commandName: string,
    rawError: string,
    commandArgs: Record<string, unknown>
  ): GitDiagnosis {
    const affectedFiles = this.extractOverwrittenFiles(rawError);
    const fileListText = affectedFiles.length > 0 ? affectedFiles.join(', ') : 'modified files';

    const summary = `Local changes in ${affectedFiles.length} file(s) would be overwritten by ${commandName.replace('git_', '')}.`;
    const explanation =
      `You have uncommitted local modifications in: [${fileListText}]. ` +
      `Proceeding with this operation would wipe out or conflict with those uncommitted edits.`;

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: `Temporarily stash local modifications in ${fileListText}.`,
        toolCall: {
          name: 'git_stash',
          arguments: { action: 'push', message: `Safe stash before ${commandName}` },
        },
      },
      {
        step: 2,
        description: `Execute ${commandName} now that the working tree is clean.`,
        toolCall: {
          name: commandName,
          arguments: commandArgs,
        },
      },
      {
        step: 3,
        description: 'Restore and re-apply your stashed modifications.',
        toolCall: {
          name: 'git_stash',
          arguments: { action: 'pop' },
        },
      },
    ];

    const suggestedUserQuestion =
      `Your uncommitted changes in ${fileListText} would be overwritten. Would you like me to stash your changes, execute ${commandName.replace('git_', '')}, and then re-apply your changes?`;

    const agentGuidance = this.createAgentGuidance({
      category: 'LOCAL_CHANGES_OVERWRITTEN',
      summary,
      affectedFiles,
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: [
        'Do not discard or revert user files without consent.',
        'Recommend the 3-step stash -> operation -> pop sequence.',
        'Ask the user for confirmation to proceed with the stash & sync plan.',
      ],
    });

    return {
      category: 'LOCAL_CHANGES_OVERWRITTEN',
      summary,
      rawError,
      affectedFiles,
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseMergeConflict(rawError: string, _commandArgs: Record<string, unknown>): GitDiagnosis {
    const affectedFiles = this.extractConflictFiles(rawError);
    const fileListText = affectedFiles.length > 0 ? affectedFiles.join(', ') : 'conflicted files';

    const summary = `Merge conflict detected in ${affectedFiles.length > 0 ? affectedFiles.length : 'repository'} file(s).`;
    const explanation =
      `Git encountered conflicting edits in: [${fileListText}]. ` +
      'Both the local branch and incoming commits modified the same lines. Manual or guided conflict resolution is required.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: `Inspect conflicted files (${fileListText}) using read_file to see conflict markers (<<<<<<<, =======, >>>>>>>).`,
      },
      {
        step: 2,
        description: 'Edit the conflicted files to keep desired changes and remove conflict markers.',
      },
      {
        step: 3,
        description: 'Stage the resolved files with git_add.',
        toolCall: {
          name: 'git_add',
          arguments: { paths: affectedFiles },
        },
      },
      {
        step: 4,
        description: 'Finalize the merge with git_commit.',
        toolCall: {
          name: 'git_commit',
          arguments: { message: `Merge conflict resolution in ${fileListText}` },
        },
      },
    ];

    const suggestedUserQuestion =
      `Merge conflicts occurred in ${fileListText}. Would you like me to inspect and help resolve the conflict markers in these files?`;

    const agentGuidance = this.createAgentGuidance({
      category: 'MERGE_CONFLICT',
      summary,
      affectedFiles,
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: [
        'Identify which lines are in conflict using read_file.',
        'Never blindly pick HEAD or incoming without inspecting.',
        'Ask the user if they would like you to inspect and resolve the conflicted files.',
      ],
    });

    return {
      category: 'MERGE_CONFLICT',
      summary,
      rawError,
      affectedFiles,
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseNoUpstreamBranch(rawError: string, commandArgs: Record<string, unknown>): GitDiagnosis {
    let branch = typeof commandArgs.branch === 'string' ? commandArgs.branch : '';
    let remote = typeof commandArgs.remote === 'string' ? commandArgs.remote : 'origin';

    const matchBranch = rawError.match(/current branch\s+([^\s]+)\s+has no upstream branch/i);
    if (matchBranch?.[1]) {
      branch = matchBranch[1];
    }
    const matchUpstreamCmd = rawError.match(/git push --set-upstream\s+([^\s]+)\s+([^\s]+)/i);
    if (matchUpstreamCmd) {
      remote = matchUpstreamCmd[1];
      branch = matchUpstreamCmd[2];
    }

    const summary = `Branch "${branch || 'current'}" has no upstream tracking branch configured on "${remote}".`;
    const explanation =
      `The local branch has not been published to "${remote}" yet with tracking enabled. ` +
      `Git needs --set-upstream to associate this local branch with the remote repository.`;

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: `Push and establish upstream tracking on ${remote}/${branch || 'current'}.`,
        toolCall: {
          name: 'git_push',
          arguments: {
            remote: remote || 'origin',
            ...(branch ? { branch } : {}),
            setUpstream: true,
          },
        },
      },
    ];

    const suggestedUserQuestion =
      `The branch "${branch || 'current'}" does not have an upstream set on "${remote}". Would you like me to push it and configure upstream tracking?`;

    const agentGuidance = this.createAgentGuidance({
      category: 'NO_UPSTREAM_BRANCH',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: [
        'Recommend pushing with upstream tracking enabled.',
        'Ask the user if they want to publish and track the branch on the remote.',
      ],
    });

    return {
      category: 'NO_UPSTREAM_BRANCH',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseUncommittedChanges(commandName: string, rawError: string): GitDiagnosis {
    const summary = `Working directory has uncommitted changes that block ${commandName.replace('git_', '')}.`;
    const explanation =
      'The requested Git operation requires a clean working tree to prevent accidentally losing work or creating invalid states.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: 'Check modified files using git_status.',
        toolCall: { name: 'git_status', arguments: {} },
      },
      {
        step: 2,
        description: 'Stash dirty changes with git_stash.',
        toolCall: { name: 'git_stash', arguments: { action: 'push', message: 'Auto-stash uncommitted edits' } },
      },
      {
        step: 3,
        description: `Re-run ${commandName.replace('git_', '')}.`,
      },
    ];

    const suggestedUserQuestion =
      'You have uncommitted changes in your workspace. Would you like me to stash them before proceeding?';

    const agentGuidance = this.createAgentGuidance({
      category: 'UNCOMMITTED_CHANGES',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: [
        'Do not discard user work.',
        'Propose stashing or committing first.',
      ],
    });

    return {
      category: 'UNCOMMITTED_CHANGES',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseDetachedHead(rawError: string): GitDiagnosis {
    const summary = 'Repository is in "detached HEAD" state.';
    const explanation =
      'HEAD is detached from a branch ref. Any commits created now will not belong to any branch and may be lost when switching branches.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: 'Inspect current status and commit using git_status.',
        toolCall: { name: 'git_status', arguments: {} },
      },
      {
        step: 2,
        description: 'Switch back to an active branch using git_checkout.',
      },
    ];

    const suggestedUserQuestion =
      'Your repository is in detached HEAD state. Would you like to switch to a named branch before making commits?';

    const agentGuidance = this.createAgentGuidance({
      category: 'DETACHED_HEAD',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: ['Warn the user that commits in detached HEAD are temporary.'],
    });

    return {
      category: 'DETACHED_HEAD',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseIndexLock(rawError: string): GitDiagnosis {
    const summary = 'Git lock file detected: .git/index.lock exists.';
    const explanation =
      'Another Git process is actively running or an earlier Git process terminated unexpectedly without cleaning up the lock file.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: 'Verify if another Git operation or terminal window is running.',
      },
      {
        step: 2,
        description: 'If no Git process is active, delete the stale .git/index.lock file.',
      },
    ];

    const suggestedUserQuestion =
      'A Git lock file was found (.git/index.lock). Would you like to check if another process is running before removing it?';

    const agentGuidance = this.createAgentGuidance({
      category: 'INDEX_LOCK',
      summary,
      affectedFiles: ['.git/index.lock'],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: ['Do not delete index.lock while a real git process is in progress.'],
    });

    return {
      category: 'INDEX_LOCK',
      summary,
      rawError,
      affectedFiles: ['.git/index.lock'],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseAuthFailure(rawError: string): GitDiagnosis {
    const summary = 'Git authentication failed (credentials, SSH key, or permissions).';
    const explanation =
      'The remote host rejected authentication. Your SSH key, personal access token (PAT), or credential helper may be invalid or expired.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: 'Verify your Git credentials or Personal Access Token for the remote host.',
      },
      {
        step: 2,
        description: 'Check that your SSH key is added to the SSH agent (ssh-add -l).',
      },
      {
        step: 3,
        description: 'Inspect configured remote URLs with git_remote.',
        toolCall: { name: 'git_remote', arguments: {} },
      },
    ];

    const suggestedUserQuestion =
      'Git authentication was rejected by the remote server. Would you like me to inspect your configured remotes?';

    const agentGuidance = this.createAgentGuidance({
      category: 'AUTHENTICATION_FAILED',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: ['Never ask the user to type passwords or secrets directly into the chat prompt.'],
    });

    return {
      category: 'AUTHENTICATION_FAILED',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: true,
    };
  }

  private static diagnoseRemoteNotFound(rawError: string, _commandArgs: Record<string, unknown>): GitDiagnosis {
    const summary = 'Remote repository or remote alias not found.';
    const explanation =
      'Git cannot find the specified remote host or URL. Either the remote name is misspelled or the repository does not exist.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: 'List and inspect configured remotes with git_remote.',
        toolCall: { name: 'git_remote', arguments: {} },
      },
    ];

    const suggestedUserQuestion =
      'The specified Git remote could not be found. Would you like me to list your configured remotes?';

    const agentGuidance = this.createAgentGuidance({
      category: 'REMOTE_NOT_FOUND',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: ['Use git_remote to check actual remote configuration.'],
    });

    return {
      category: 'REMOTE_NOT_FOUND',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseBranchOrPathspecNotFound(rawError: string): GitDiagnosis {
    const summary = 'Branch name or pathspec not found in repository.';
    const explanation =
      'Git could not find the specified branch or path. It may not exist locally, or may be spelled differently.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: 'Inspect available local and remote branches with git_branch.',
        toolCall: { name: 'git_branch', arguments: {} },
      },
    ];

    const suggestedUserQuestion =
      'The branch or path was not found. Would you like me to list available branches?';

    const agentGuidance = this.createAgentGuidance({
      category: 'BRANCH_NOT_FOUND',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: ['Use git_branch to locate the exact branch name.'],
    });

    return {
      category: 'BRANCH_NOT_FOUND',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseNotAGitRepo(rawError: string): GitDiagnosis {
    const summary = 'Current workspace is not a Git repository.';
    const explanation =
      'The workspace folder has not been initialized with `git init` or the `.git` directory is missing.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: 'Initialize a new repository with git init or open a folder containing a .git repository.',
      },
    ];

    const suggestedUserQuestion =
      'This folder is not a Git repository. Would you like to initialize a new Git repository here?';

    const agentGuidance = this.createAgentGuidance({
      category: 'NOT_A_GIT_REPOSITORY',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: ['Do not run git operations until a git repository is established.'],
    });

    return {
      category: 'NOT_A_GIT_REPOSITORY',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: true,
    };
  }

  private static diagnoseNothingToCommit(rawError: string): GitDiagnosis {
    const summary = 'Nothing to commit: working tree is clean or changes are unstaged.';
    const explanation =
      'No files are currently staged for commit. Either no files have changed, or modified files have not been staged yet with git_add.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: 'Inspect modified and untracked files with git_status.',
        toolCall: { name: 'git_status', arguments: {} },
      },
    ];

    const suggestedUserQuestion =
      'No files are staged to commit. Would you like me to check git status to see if there are unstaged changes to add?';

    const agentGuidance = this.createAgentGuidance({
      category: 'NOTHING_TO_COMMIT',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: ['Check git_status before attempting to commit.'],
    });

    return {
      category: 'NOTHING_TO_COMMIT',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseStashEmpty(rawError: string): GitDiagnosis {
    const summary = 'Stash operation completed: Stash list is empty or no uncommitted changes were found.';
    const explanation = 'There are no stashed commits to pop/apply, or no local file modifications exist to save.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: 'Verify current workspace status with git_status.',
        toolCall: { name: 'git_status', arguments: {} },
      },
    ];

    const suggestedUserQuestion = 'The stash list is empty. Would you like to check current workspace status?';

    const agentGuidance = this.createAgentGuidance({
      category: 'STASH_EMPTY',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: ['Do not attempt to pop an empty stash.'],
    });

    return {
      category: 'STASH_EMPTY',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseGenericError(
    commandName: string,
    rawError: string,
    _commandArgs: Record<string, unknown>
  ): GitDiagnosis {
    const summary = `Git command "${commandName}" encountered an unexpected error.`;
    const explanation = rawError.split('\n').filter(Boolean).slice(0, 3).join(' ') || 'The Git operation returned an error.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: 'Inspect repository status with git_status.',
        toolCall: { name: 'git_status', arguments: {} },
      },
    ];

    const suggestedUserQuestion =
      `Git ${commandName.replace('git_', '')} failed. Would you like me to inspect repository status and help determine the fix?`;

    const agentGuidance = this.createAgentGuidance({
      category: 'UNKNOWN_GIT_ERROR',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: [
        'Do not hallucinate git flags or commands.',
        'Explain the error clearly and offer to check git_status.',
      ],
    });

    return {
      category: 'UNKNOWN_GIT_ERROR',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseGitLabProtectedBranch(rawError: string, commandArgs: Record<string, unknown>): GitDiagnosis {
    const branch = typeof commandArgs.branch === 'string' && commandArgs.branch ? commandArgs.branch : 'main';
    const remote = typeof commandArgs.remote === 'string' && commandArgs.remote ? commandArgs.remote : 'origin';
    const mrUrl = this.extractGitLabMergeRequestUrl(rawError);

    const summary = `GitLab rejected push: The target branch "${branch}" is protected.`;
    const explanation =
      `GitLab project rules protect "${branch}" from direct pushes and force-pushes. ` +
      `On GitLab, changes destined for protected branches must be pushed to a separate feature branch and reviewed via a Merge Request (MR).`;

    const newBranch = `feature/${branch !== 'main' && branch !== 'master' ? branch : 'update'}`;

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: `Create and switch to feature branch "${newBranch}" with git_checkout.`,
        toolCall: {
          name: 'git_checkout',
          arguments: { branch: newBranch, createBranch: true },
        },
      },
      {
        step: 2,
        description: `Push "${newBranch}" to ${remote} with git_push.`,
        toolCall: {
          name: 'git_push',
          arguments: { remote, branch: newBranch, setUpstream: true },
        },
      },
      {
        step: 3,
        description: mrUrl
          ? `Open GitLab Merge Request: ${mrUrl}`
          : `Create a Merge Request on GitLab to merge "${newBranch}" into "${branch}".`,
      },
    ];

    const suggestedUserQuestion =
      `The branch "${branch}" is protected by GitLab. Would you like me to branch off to "${newBranch}" and push it so you can open a Merge Request?`;

    const agentGuidance = this.createAgentGuidance({
      category: 'GITLAB_PROTECTED_BRANCH',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: [
        'NEVER attempt a force-push to a protected GitLab branch.',
        'Always recommend creating a feature branch and opening a GitLab Merge Request.',
      ],
    });

    return {
      category: 'GITLAB_PROTECTED_BRANCH',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseGitLabPushRule(rawError: string, _commandArgs: Record<string, unknown>): GitDiagnosis {
    const summary = 'GitLab push rule or pre-receive hook rejected the commit.';
    const explanation =
      'GitLab server-side Push Rules (such as commit message pattern constraints, author email verification, secret detection, or branch naming restrictions) blocked your push.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: 'Review the GitLab rejection message above to identify the violated push rule or hook constraint.',
      },
      {
        step: 2,
        description: 'Amend the commit using git commit --amend to update the commit message or author.',
      },
      {
        step: 3,
        description: 'Retry pushing to GitLab once compliant.',
      },
    ];

    const suggestedUserQuestion =
      'GitLab rejected the commit based on repository push rules. Would you like to review and amend the last commit message or author details?';

    const agentGuidance = this.createAgentGuidance({
      category: 'GITLAB_PUSH_RULE',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: [
        'Inform the user of the exact GitLab push rule or hook failure reason.',
        'Guide the user to amend the commit instead of attempting force-push workarounds.',
      ],
    });

    return {
      category: 'GITLAB_PUSH_RULE',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: false,
    };
  }

  private static diagnoseGitLabAuth2FA(rawError: string): GitDiagnosis {
    const summary = 'GitLab authentication failed: Personal Access Token (PAT) required for 2FA.';
    const explanation =
      'GitLab requires a Personal Access Token (PAT) because Two-Factor Authentication (2FA) is enabled or password authentication is disabled on this GitLab instance.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: 'Log into GitLab and navigate to User Settings > Access Tokens.',
      },
      {
        step: 2,
        description: 'Create a Personal Access Token with the "write_repository" and "read_repository" scopes.',
      },
      {
        step: 3,
        description: 'Authenticate your Git push with the token (or configure Git Credential Manager / SSH key).',
      },
    ];

    const suggestedUserQuestion =
      'GitLab requires a Personal Access Token (PAT) with write_repository scope. Have you generated a token to authenticate with?';

    const agentGuidance = this.createAgentGuidance({
      category: 'GITLAB_AUTH_2FA',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: [
        'Never ask the user to type passwords or tokens into the chat prompt.',
        'Direct the user to generate a token with write_repository scope in GitLab User Settings.',
      ],
    });

    return {
      category: 'GITLAB_AUTH_2FA',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: true,
    };
  }

  private static diagnoseGitLabStorageLimit(rawError: string): GitDiagnosis {
    const summary = 'GitLab storage quota or file size limit exceeded.';
    const explanation =
      'GitLab rejected the push because the project has exceeded its repository storage quota or a file exceeds the maximum allowed file size.';

    const suggestedSteps: GitRemediationStep[] = [
      {
        step: 1,
        description: 'Inspect recent commits for large binary files or archives.',
      },
      {
        step: 2,
        description: 'Track large assets using Git LFS (git lfs track "*.ext").',
      },
      {
        step: 3,
        description: 'Remove large files from commit history or increase the GitLab project storage quota.',
      },
    ];

    const suggestedUserQuestion =
      'GitLab rejected the push due to storage or file size limits. Would you like me to help identify large files in your recent commit?';

    const agentGuidance = this.createAgentGuidance({
      category: 'GITLAB_STORAGE_LIMIT',
      summary,
      affectedFiles: [],
      suggestedSteps,
      question: suggestedUserQuestion,
      strictSafetyRules: [
        'Do not force push without removing the oversized files first.',
        'Recommend Git LFS for binary assets exceeding GitLab limits.',
      ],
    });

    return {
      category: 'GITLAB_STORAGE_LIMIT',
      summary,
      rawError,
      affectedFiles: [],
      explanation,
      suggestedSteps,
      remediationPrompt: suggestedUserQuestion,
      suggestedUserQuestion,
      agentGuidance,
      isFatal: true,
    };
  }

  /**
   * Extracts GitLab Merge Request URLs from push stdout/stderr if generated by GitLab.
   */
  static extractGitLabMergeRequestUrl(text: string): string | null {
    const match =
      text.match(/(?:To create a merge request for [^,\n]+,\s*visit:\s*|View merge request for [^:\n]+:\s*)(https?:\/\/[^\s]+)/i) ||
      text.match(/(https?:\/\/[^\s\/]+[^\s]*\/-\/merge_requests\/(?:new\?[^\s]+|\d+))/i);
    return match ? (match[1] || match[0]) : null;
  }

  /**
   * Builds an unambiguous, model-agnostic decision-making directive for any LLM.
   */
  private static createAgentGuidance(options: {
    category: GitErrorCategory;
    summary: string;
    affectedFiles: string[];
    suggestedSteps: GitRemediationStep[];
    question: string;
    strictSafetyRules: string[];
  }): string {
    const stepList = options.suggestedSteps.map((s) => `  ${s.step}. ${s.description}`).join('\n');
    const rules = options.strictSafetyRules.map((r) => `  - ${r}`).join('\n');
    const fileNotice = options.affectedFiles.length > 0 ? `\nAffected Files: ${options.affectedFiles.join(', ')}` : '';

    return [
      `[GIT DIAGNOSTIC ANALYSIS]`,
      `Problem: ${options.summary}${fileNotice}`,
      `Recommended Strategy:\n${stepList}`,
      `Safety Rules:\n${rules}`,
      `AGENT ACTION DIRECTIVE:`,
      `1. Explain what happened in 1-2 friendly sentences. Do not dump raw stack traces.`,
      `2. If the user already instructed you to proceed with recovery or resolve conflicts, execute the first recommended tool immediately.`,
      `3. Otherwise, propose the remedy and ask for user confirmation:`,
      `   "${options.question}"`,
    ].join('\n');
  }

  /**
   * Parses files listed in "Your local changes to the following files would be overwritten"
   */
  static extractOverwrittenFiles(text: string): string[] {
    const match = text.match(/(?:following files would be overwritten by [^:]+:|following untracked working tree files would be overwritten by [^:]+:)([\s\S]*?)(?:Please commit|Please move|Aborting|$)/i);
    if (!match?.[1]) {
      return [];
    }

    return match[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && !line.startsWith('error:') && !line.startsWith('hint:') && !line.startsWith('fatal:'));
  }

  /**
   * Parses files listed in "CONFLICT (content): Merge conflict in <file>"
   */
  static extractConflictFiles(text: string): string[] {
    const files = new Set<string>();
    const regex = /CONFLICT\s*\([^)]*\):\s*(?:Merge conflict in|content in)\s*([^\r\n]+)/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        files.add(match[1].trim());
      }
    }

    return Array.from(files);
  }

  /**
   * Formats a human-readable markdown card suitable for VS Code chat streams or UI logs.
   */
  static formatDiagnosticReport(diagnosis: GitDiagnosis): string {
    const lines: string[] = [
      `### ⚠️ Git Operation Issue: ${diagnosis.summary}`,
      '',
      diagnosis.explanation,
      '',
    ];

    if (diagnosis.affectedFiles.length > 0) {
      lines.push('**Affected Files:**');
      for (const file of diagnosis.affectedFiles) {
        lines.push(`- \`${file}\``);
      }
      lines.push('');
    }

    if (diagnosis.suggestedSteps.length > 0) {
      lines.push('**Recommended Next Steps:**');
      for (const step of diagnosis.suggestedSteps) {
        lines.push(`${step.step}. ${step.description}`);
      }
      lines.push('');
    }

    lines.push(`💡 **Suggested Action:** ${diagnosis.suggestedUserQuestion}`);

    return lines.join('\n');
  }
}
