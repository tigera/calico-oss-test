"""Fixture: item processing pipeline."""


def process(items, config):
    results = []
    for item in items:
        for attempt in range(config.retries):
            try:
                results.append(transform(item))
                break
            except TransformError:
                if attempt == config.retries - 1:
                    raise
    return results
