"""Local SQLite custody primitives.

SQLite is journal/query metadata, not portable design authority. This package
keeps migration and write-transaction ownership inside the local daemon API.
"""

from .db import Database, Migration, MigrationError, TransactionOwnershipError

__all__ = [
    "Database",
    "Migration",
    "MigrationError",
    "TransactionOwnershipError",
]
