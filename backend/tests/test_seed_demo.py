def test_seed_is_opt_in_idempotent_and_does_not_create_users(app):
    from app.extensions import db
    from app.models import (Cliente, Material, ProductoCatalogo, Pedido, Usuario,
                            EntregaParcialItem, ReporteFaltante)
    from seed_demo import seed_demo
    with app.app_context():
        assert Usuario.query.count() == Pedido.query.count() == 0
        seed_demo()
        models = (Cliente, Material, ProductoCatalogo, Pedido, Usuario,
                  EntregaParcialItem, ReporteFaltante)
        before = [model.query.count() for model in models]
        assert all(count > 0 for count in before[:4])
        assert before[4] == 0 and before[5] > 0 and before[6] > 0
        assert {'En Cola', 'Procesando', 'Terminado', 'Facturado'} <= {p.estado for p in Pedido.query.all()}
        # Running it again must preserve changes made by an operator too.
        material = Material.query.first()
        material.stock_actual = 77
        db.session.commit()
        seed_demo()
        assert [model.query.count() for model in models] == before
        assert db.session.get(Material, material.id).stock_actual == 77


def test_seed_cli_requires_explicit_flag(app):
    from seed_demo import main
    import pytest
    with pytest.raises(SystemExit) as exc:
        main([])
    assert exc.value.code == 2


def test_seed_cli_uses_isolated_environment_and_is_repeatable(app):
    import subprocess
    import sys
    from conftest import BACKEND
    from app.models import Pedido, Usuario
    for _ in range(2):
        result = subprocess.run([sys.executable, str(BACKEND / 'seed_demo.py'), '--crear-demo'],
                                cwd=BACKEND, capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, result.stderr
    with app.app_context():
        assert Pedido.query.count() == 5
        assert Usuario.query.count() == 0
