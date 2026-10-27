"""Local API; start explicitly with backend/.venv/bin/python backend/run.py."""
import os
from app import create_app


def main():
    port = int(os.environ.get('SGP_NUEVA_PORT', '5101'))
    if not 1024 <= port <= 65535 or port == 5001:
        raise ValueError('SGP_NUEVA_PORT debe estar entre 1024 y 65535, excepto 5001')
    create_app().run(host='127.0.0.1', port=port, debug=False, use_reloader=False)


if __name__ == '__main__':
    main()
