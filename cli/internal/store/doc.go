// Package store provides a durable, JSON-backed kanban board.
//
// Writers coordinate through a persistent <Path>.lock file. Linux and macOS use
// flock; Windows uses an exclusive, non-sharing file handle. Locks are released
// by the OS when their handle closes or the process exits, and are never stolen
// or unlinked. Other platforms refuse writes rather than provide unsafe locking.
// Readers need no lock because complete files are published atomically.
//
// Updates publish with rename. Init uses a same-directory hard link instead,
// which atomically publishes the complete file without replacing an existing
// destination, even if its creator does not participate in locking. A filesystem
// supporting hard links is therefore required for Init. Files are synced before
// publication, and the containing directory is synced afterward where supported.
// Newly created directory entries are also synced in their own parents.
// Windows has no portable directory-sync operation in the standard library.
// A post-publication failure explicitly reports that the change is committed but
// its durability is uncertain; callers must not blindly retry such an update.
// Ordinary failures clean up temporary files. Abrupt process termination may
// leave an orphan temporary file; these are not automatically scavenged.
//
// Newly created directories have mode 0700 (subject to umask), and board and lock
// files are created with mode 0600. Existing directories are not chmodded. On
// Windows, access control is inherited from the directory's ACL instead. The
// parent directory must be trusted: parent symlinks are resolved for consistent
// locking, but concurrent hostile replacement of directory components is outside
// this package's guarantees. Advisory locking and atomic publication also depend
// on the filesystem honoring their local-filesystem semantics.
// Windows replacement uses os.Rename; Go does not promise rename atomicity on
// non-Unix platforms, so Unix-equivalent crash guarantees cannot be promised there.
package store
