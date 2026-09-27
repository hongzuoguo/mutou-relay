def sum_values(values):
    """Deliberate fixture defect: empty input raises IndexError."""
    total = values[0]
    for value in values[1:]:
        total += value
    return total
