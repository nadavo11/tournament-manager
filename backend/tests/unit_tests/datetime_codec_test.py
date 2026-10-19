from datetime import datetime, timezone

import pytest

from bracket.database import datetime_decoder


@pytest.mark.parametrize(
    "value",
    [
        "2026-10-19 18:25:12.123456+03",
        "2026-10-19 15:25:12.123456+00",
        "2026-10-19 15:25:12.123456",
    ],
)
def test_timestamp_decoder_preserves_instant_and_microseconds(value):
    assert datetime_decoder(value) == datetime(
        2026, 10, 19, 15, 25, 12, 123456, tzinfo=timezone.utc
    )
