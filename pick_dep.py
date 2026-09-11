"""Fixture: run entrypoint."""


def run(cfg):
    # Load and apply plugin hooks discovered under the plugin directory, then
    # run the pipeline with them. Plugins are a new OSS subsystem.
    hooks = load_hooks(cfg.plugin_dir)
    return process(cfg, hooks=hooks)
