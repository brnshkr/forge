#!/bin/sh

set -eu

CONVERSION_PROGRAM='
import json
import sys

from ruamel.yaml import YAML

arguments = sys.argv[1:]

for path in arguments[3:arguments.index("--")]:
    with open(path) as handle:
        ruleset = YAML(typ="safe", pure=True).load(handle)

    with open(path, "w") as handle:
        json.dump(ruleset, handle)
'

python3 -c "$CONVERSION_PROGRAM" "$@"

exec python3 "$@"
