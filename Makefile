#-- forge

#!! This project's targets

DOTENV_DEFAULT_ENV := forge
APP_SERVICE        := cli
JS_SERVICE         := $(APP_SERVICE)
APP_SERVICE_MODE    = run
SERVICE_SHELL       = bash

###> brnshkr/config ###
_BRNSHKR_CONFIG_PATHS := $(CURDIR)/node_modules/@brnshkr/config/conf/Makefile $(CURDIR)/$(or $(if $(wildcard $(CURDIR)/composer.json),$(shell awk 'match($$0, /"vendor-dir"[[:space:]]*:[[:space:]]*"[^"]*"/) { vendor_directory = substr($$0, RSTART, RLENGTH); sub(/^[^:]*:[[:space:]]*"/, "", vendor_directory); sub(/"$$/, "", vendor_directory); print vendor_directory; exit }' $(CURDIR)/composer.json)), vendor)/brnshkr/config/conf/Makefile

ifeq ($(wildcard $(_BRNSHKR_CONFIG_PATHS)),)
bootstrap:
	@$(if $(wildcard $(CURDIR)/package.json),$(_BRNSHKR_JS_RUN) $(_BRNSHKR_JS_INSTALL))
	@$(if $(wildcard $(CURDIR)/composer.json),$(_BRNSHKR_RUN) composer install --no-scripts --ignore-platform-reqs)
	@for path in $(_BRNSHKR_CONFIG_PATHS); do [ -r "$$path" ] && exit 0; done; echo 'brnshkr/config is not installed' >&2; exit 1
	@$(MAKE) --no-print-directory startup
else
include $(firstword $(wildcard $(_BRNSHKR_CONFIG_PATHS)))
endif
###< brnshkr/config ###

_STAGE := $(or $(APP_ENV),$(DOTENV_DEFAULT_ENV))

ifeq ($(wildcard $(CURDIR)/.env.$(_STAGE)),)
  $(error [$(_LABEL)] `.env.$(_STAGE)` does not exist, `$(_STAGE)` is not a stage this repository has)
endif

# NOTICE: `braces` has no fixed release and upstream disputes the advisory:
# https://github.com/advisories/GHSA-vfj7-8cjw-p6xm, https://github.com/micromatch/braces/issues/70
BUN_AUDIT_FLAGS += --ignore GHSA-vfj7-8cjw-p6xm

# NOTICE: Only `minimatch` 11 fixes it, a major ESLint's dependencies do not accept yet:
# https://github.com/advisories/GHSA-g3hv-75wg-m249
BUN_AUDIT_FLAGS += --ignore GHSA-g3hv-75wg-m249

#--- docker

_IMAGE_KEYS := IMAGE_NAME \
	IMAGE_TARGET \
	IMAGE_SUFFIX

_STAGE_IMAGE = $(shell $(AWK) -F= -v _KEYS='$(_IMAGE_KEYS)' \
	'{ value_by_key[$$1] = substr($$0, length($$1) + 2) } END { count = split(_KEYS, keys, " "); for (i = 1; i <= count; i += 1) print keys[i] "=" value_by_key[keys[i]] }' \
	'$(CURDIR)/.env.$(_STAGE)')

_OVERRIDDEN_IMAGE = $(filter-out $(_STAGE_IMAGE),$(foreach KEY,$(_IMAGE_KEYS),$(KEY)=$($(KEY))))
_OVERRIDE_REFUSAL = [$(_LABEL)] `$(_OVERRIDDEN_IMAGE)` differs from `.env.$(_STAGE)`. Pick the image with `APP_ENV`

validate: #~~ fails when the image settings differ from what the stage names
	@:$(if $(_OVERRIDDEN_IMAGE),$(error $(_OVERRIDE_REFUSAL)))

build: _GOAL := build
build: validate cli-build #~~ builds the image the stage names

#--- bump

bump-tools: _DECLARED_KEYS  += GITHUB_TOKEN
bump-tools: _FORWARDED_KEYS += MINIMUM_RELEASE_AGE
bump-tools: #~~ moves the tool pins in `.env` to their newest release old enough to trust
	$(DEBUG_PREFIX)$(BUN) $(BUN_FLAGS) ./scripts/bump-tools.ts $(ARGS) --seen-file=./.cache/bump.cache.json

bump: _GOAL := bump
bump: bump-tools #~~ moves every pin this repository owns

#--- semgrep

SEMGREP_PYTHON = $(_SEMGREP_RUN) sh $(APP_DIR)/scripts/semgrep-python.sh

###> brnshkr/config ###
_BRNSHKR_COMPOSE_CANDIDATES := compose.yaml \
	compose.yml \
	docker-compose.yaml \
	docker-compose.yml

_BRNSHKR_COMPOSE_FILES = $(or \
	$(subst :, ,$(COMPOSE_FILE)), \
	$(firstword $(wildcard \
		$(addprefix $(CURDIR)/,$(_BRNSHKR_COMPOSE_CANDIDATES)) \
		$(addprefix $(CURDIR)/$(or $(CONFIG_DIR),conf)/,$(_BRNSHKR_COMPOSE_CANDIDATES)) \
	)) \
)

_BRNSHKR_STAGE = $(or $(APP_ENV),$(DOTENV_DEFAULT_ENV),dev)

_BRNSHKR_DOTENV_FILES = $(wildcard \
	$(or $(wildcard $(CURDIR)/.env),$(CURDIR)/.env.dist) \
	$(CURDIR)/.env.local \
	$(CURDIR)/.env.$(_BRNSHKR_STAGE) \
	$(CURDIR)/.env.$(_BRNSHKR_STAGE).local \
)

ifeq ($(wildcard $(_BRNSHKR_CONFIG_PATHS)),)
_BRNSHKR_DOTENV_KEYS := $(shell awk -F= '/^[A-Z_a-z][0-9A-Z_a-z]*=/ { print $$1 }' $(_BRNSHKR_DOTENV_FILES))

-include $(_BRNSHKR_DOTENV_FILES)
$(foreach KEY,$(_BRNSHKR_DOTENV_KEYS),$(eval $(KEY) = $(subst ",,$(subst ',,$(value $(KEY))))))
export $(_BRNSHKR_DOTENV_KEYS)
endif

_BRNSHKR_COMPOSE = HOST_UID="$$(id -u)" HOST_GID="$$(id -g)" HOST_APP_DIR='$(CURDIR)' FORGE_REPOSITORY='$(or $(FORGE_REPOSITORY),ghcr.io/brnshkr/forge)' docker compose \
	$(addprefix -f ,$(_BRNSHKR_COMPOSE_FILES))

_BRNSHKR_RUN    = $(and $(APP_SERVICE),$(_BRNSHKR_COMPOSE_FILES),$(_BRNSHKR_COMPOSE) run --rm $(APP_SERVICE))
_BRNSHKR_JS_RUN = $(and $(JS_SERVICE),$(_BRNSHKR_COMPOSE_FILES),$(_BRNSHKR_COMPOSE) run --rm $(JS_SERVICE))
_BRNSHKR_FROZEN = $(if $(filter-out 0 false,$(CI)), --frozen-lockfile)

_BRNSHKR_JS_INSTALL = $(or \
	$(if $(wildcard $(CURDIR)/bun.lock $(CURDIR)/bun.lockb),bun install$(_BRNSHKR_FROZEN)), \
	$(if $(wildcard $(CURDIR)/yarn.lock),yarn install), \
	$(if $(wildcard $(CURDIR)/pnpm-lock.yaml),pnpm install), \
	$(if $(wildcard $(CURDIR)/package-lock.json),npm install), \
	bun install \
)
###< brnshkr/config ###
