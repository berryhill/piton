"""Local custody primitives for Piton's blobs and SQLite journal metadata.

SQLite is journal/query metadata, not portable design authority. This package
keeps migration and write-transaction ownership inside the local daemon API.
"""

from .blobs import (
    ArtifactRef,
    BlobCollisionError,
    BlobStore,
    BlobValidationError,
    CustodyError,
    StagedBlob,
)
from .build_attempts import (
    BuildAdmission,
    BuildAttemptConflictError,
    BuildAttemptCoordinator,
    CoordinatorState,
    DurableBuildAttempt,
    LeaseConflictError,
)
from .db import Database, Migration, MigrationError, TransactionOwnershipError
from .revisions import (
    ActorAuthorityError,
    ChannelConflictError,
    ChannelPointer,
    PersistenceConflictError,
    RevisionRepository,
    StartupRecoveryError,
)

__all__ = [
    "ActorAuthorityError",
    "ArtifactRef",
    "BlobCollisionError",
    "BlobStore",
    "BlobValidationError",
    "BuildAdmission",
    "BuildAttemptConflictError",
    "BuildAttemptCoordinator",
    "ChannelConflictError",
    "ChannelPointer",
    "CoordinatorState",
    "CustodyError",
    "Database",
    "DurableBuildAttempt",
    "LeaseConflictError",
    "Migration",
    "MigrationError",
    "PersistenceConflictError",
    "RevisionRepository",
    "StartupRecoveryError",
    "StagedBlob",
    "TransactionOwnershipError",
]
