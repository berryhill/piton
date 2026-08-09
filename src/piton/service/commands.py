"""Typed command values for Piton's sole custody application boundary."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping

from ..source_tree import SourceTree


def _required(name: str, value: str) -> None:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty string")


def _parameters(values: Mapping[str, str]) -> Mapping[str, str]:
    copied = dict(values)
    if not all(isinstance(key, str) and key for key in copied):
        raise ValueError("parameter names must be non-empty strings")
    if not all(isinstance(value, str) for value in copied.values()):
        raise ValueError("parameter values must be strings")
    return MappingProxyType(copied)


def _generation(value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("expected_generation must be a non-negative integer")


@dataclass(frozen=True, slots=True)
class CreateProject:
    command_id: str
    project_id: str
    display_name: str

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id", "display_name"):
            _required(name, getattr(self, name))


@dataclass(frozen=True, slots=True)
class ImportSourceBase:
    command_id: str
    project_id: str
    source_tree: SourceTree
    parameter_values: Mapping[str, str]

    def __post_init__(self) -> None:
        _required("command_id", self.command_id)
        _required("project_id", self.project_id)
        if not isinstance(self.source_tree, SourceTree):
            raise TypeError("source_tree must be a SourceTree")
        object.__setattr__(self, "parameter_values", _parameters(self.parameter_values))


@dataclass(frozen=True, slots=True)
class BeginDraft:
    command_id: str
    project_id: str
    base_revision_id: str
    expected_generation: int

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id", "base_revision_id"):
            _required(name, getattr(self, name))
        _generation(self.expected_generation)


@dataclass(frozen=True, slots=True)
class UpdateDraft:
    command_id: str
    project_id: str
    draft_id: str
    source_tree: SourceTree

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id", "draft_id"):
            _required(name, getattr(self, name))
        if not isinstance(self.source_tree, SourceTree):
            raise TypeError("source_tree must be a SourceTree")


@dataclass(frozen=True, slots=True)
class CommitDraft:
    command_id: str
    project_id: str
    draft_id: str
    expected_revision_id: str
    expected_generation: int
    parameter_values: Mapping[str, str]

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id", "draft_id", "expected_revision_id"):
            _required(name, getattr(self, name))
        _generation(self.expected_generation)
        object.__setattr__(self, "parameter_values", _parameters(self.parameter_values))


@dataclass(frozen=True, slots=True)
class DiscardDraft:
    command_id: str
    project_id: str
    draft_id: str

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id", "draft_id"):
            _required(name, getattr(self, name))


@dataclass(frozen=True, slots=True)
class RestoreForward:
    command_id: str
    project_id: str
    target_revision_id: str
    expected_revision_id: str
    expected_generation: int

    def __post_init__(self) -> None:
        for name in (
            "command_id",
            "project_id",
            "target_revision_id",
            "expected_revision_id",
        ):
            _required(name, getattr(self, name))
        _generation(self.expected_generation)
