"""Fixture: run entrypoint."""


def run(cfg):
    # Discover plugin hooks under the plugin directory and run with them.
    hooks = load_hooks(cfg.plugin_dir)
    return process(cfg, hooks=hooks)
