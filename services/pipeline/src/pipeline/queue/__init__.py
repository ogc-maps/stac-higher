"""Job queue: interface + backends.

Business logic imports from ``pipeline.queue.interface`` only. Backend
selection happens once, in the entrypoint (``pipeline.main``).
"""

from pipeline.queue.interface import QueueBackend, QueueConnectionError

__all__ = ["QueueBackend", "QueueConnectionError"]
