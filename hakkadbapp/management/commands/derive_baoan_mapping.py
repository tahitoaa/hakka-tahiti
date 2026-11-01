"""Wenfa -> Bao'an mapping: `derive_source_mapping baoan` under its historical
name (same options: --write, --csv)."""
from .derive_source_mapping import Command as SourceMappingCommand


class Command(SourceMappingCommand):
    help = "Derive the Wenfa -> Bao'an transcription mapping (= derive_source_mapping baoan)."
    default_source = "baoan"
