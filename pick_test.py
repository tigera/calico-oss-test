"""Fixture: item processing pipeline."""


def process(items, config):
    results = []
    for item in items:
        try:
            results.append(transform(item))
        except TransformError:
            continue
    return results
