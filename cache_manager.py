# cache_manager.py
import json
import os
from typing import Dict, Any, Optional

class CacheManager:
    def __init__(self, cache_file: str = "jargon_cache.json"):
        self.cache_file = cache_file
        self.cache = self._load_cache()

    def _load_cache(self) -> Dict[str, Any]:
        if os.path.exists(self.cache_file):
            try:
                with open(self.cache_file, "r") as f:
                    return json.load(f)
            except json.JSONDecodeError:
                return {}
        return {}

    def get(self, term: str) -> Optional[Dict[str, Any]]:
        return self.cache.get(term.lower())

    def set(self, term: str, data: Dict[str, Any]) -> None:
        self.cache[term.lower()] = data
        with open(self.cache_file, "w") as f:
            json.dump(self.cache, f, indent=4)