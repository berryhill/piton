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
from .db import Database, Migration, MigrationError, TransactionOwnershipError

__all__ = [
    "ArtifactRef",
    "BlobCollisionError",
    "BlobStore",
    "BlobValidationError",
    "CustodyError",
    "Database",
    "Migration",
    "MigrationError",
    "StagedBlob",
    "TransactionOwnershipError",
]
