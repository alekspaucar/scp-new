import pytest


@pytest.mark.parametrize('configured,expected', [(None, 5101), ('5102', 5102), ('1024', 1024), ('65535', 65535)])
def test_run_uses_loopback_and_never_reloads(monkeypatch, configured, expected):
    import run
    if configured is None:
        monkeypatch.delenv('SGP_NUEVA_PORT', raising=False)
    else:
        monkeypatch.setenv('SGP_NUEVA_PORT', configured)
    monkeypatch.setenv('PORT', '80')
    monkeypatch.setenv('FLASK_DEBUG', '1')
    calls = []
    class FakeApp:
        def run(self, **kwargs):
            calls.append(kwargs)
    monkeypatch.setattr(run, 'create_app', FakeApp)
    run.main()
    assert calls == [{'host': '127.0.0.1', 'port': expected, 'debug': False, 'use_reloader': False}]


@pytest.mark.parametrize('port', ['0', '1023', '5001', '65536', 'invalid'])
def test_run_rejects_invalid_port_without_creating_application(monkeypatch, port):
    import run
    monkeypatch.setenv('SGP_NUEVA_PORT', port)
    def unexpected():
        raise AssertionError('Should reject the port before creating the app')
    monkeypatch.setattr(run, 'create_app', unexpected)
    with pytest.raises(ValueError):
        run.main()
