import os
from hmac import compare_digest
from flask import Flask, jsonify
from flask_login import LoginManager
from sqlalchemy import text
from .extensions import db
from .models import Usuario, ProductoCatalogo, EntregaParcialItem, ReporteFaltante
from config import Config, INSTANCE_ROOT, validate_storage

def create_app():
    configuration = Config()
    app = Flask(__name__, instance_path=str(INSTANCE_ROOT), static_folder=None)
    app.config.from_object(configuration)
    # La cookie de sesión no viaja en peticiones cross-site (mitiga CSRF)
    if not app.config.get('SESSION_COOKIE_SAMESITE'):
        app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

    # Carpeta donde se guardan las imágenes/PDF de referencia del catálogo
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

    db.init_app(app)

    login_manager = LoginManager()
    login_manager.init_app(app)

    @login_manager.unauthorized_handler
    def unauthorized():
        return jsonify({'error': 'Inicia sesión para continuar'}), 401

    @app.before_request
    def check_storage_boundaries():
        try:
            validate_storage()
        except ValueError:
            return jsonify({'error': 'Almacenamiento fuera de las rutas permitidas'}), 403

    @app.errorhandler(403)
    def forbidden(error):
        return jsonify({'error': 'Acceso denegado'}), 403

    @app.errorhandler(404)
    def not_found(error):
        return jsonify({'error': 'Recurso no encontrado'}), 404

    @login_manager.user_loader
    def load_user(token):
        if not isinstance(token, str):
            return None
        parts = token.split(':')
        if (len(parts) != 2 or not parts[0].isascii() or not parts[0].isdigit()
                or len(parts[0]) > 19 or len(parts[1]) != 64
                or any(c not in '0123456789abcdef' for c in parts[1])):
            return None
        user_id = int(parts[0])
        if not 0 < user_id <= 9223372036854775807:
            return None
        user = db.session.get(Usuario, user_id)
        return user if user is not None and compare_digest(token, user.get_id()) else None

    from .routes.auth import auth_bp
    from .routes.main import main_bp
    from .routes.indicators import indicators_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(indicators_bp)

    with app.app_context():
        db.create_all()
        _migrar_revisiones()
        _migrar_permisos_y_origen_movimientos()
        _migrar_material_columnas()
        _migrar_pedido_columnas()
        _migrar_catalogo_imagen()
        _migrar_pedido_item_columnas()
        _migrar_pedido_item_observacion()
        _migrar_pedido_item_modo_parcial()
        _migrar_catalogo_tipo_codigo()
        _migrar_cliente_logo()
        _migrar_entrega_parcial_items()
        _migrar_pedido_item_estado_previo()
        _migrar_pedido_observacion_retroceso()
        _migrar_catalogo_planificacion()
        _migrar_catalogo_constraint()
        _migrar_pedido_planificacion()

    return app


def _migrar_revisiones():
    """Add versions only to the configured, confined new SQLite database."""
    validate_storage()
    with db.engine.begin() as con:
        con.execute(text('BEGIN IMMEDIATE'))
        for tabla in ('materiales', 'pedidos'):
            columnas = {fila[1] for fila in con.execute(text(f'PRAGMA table_info({tabla})'))}
            if 'revision' not in columnas:
                con.execute(text(f'ALTER TABLE {tabla} ADD COLUMN revision INTEGER NOT NULL DEFAULT 1'))

def _migrar_catalogo_constraint():
    """Unifica la migración de las restricciones antiguas, conservando columnas."""
    _migrar_catalogo_codigo_sin_codigo()

def _migrar_material_columnas():
    """materiales: agrega las columnas nuevas (acabado, cantidad_ml,
    clasificacion) si no existen y puebla `clasificacion` de todas las filas
    existentes según su categoria. db.create_all() no altera tablas ya
    creadas, así que las columnas se agregan aquí con ALTER TABLE."""
    mapeo_clasificacion = {
        'Materia Prima': 'Materia Prima',
        'Tintas': 'Insumo',
        'Herramientas': 'Insumo',
    }
    with db.engine.begin() as con:
        columnas = {fila[1] for fila in con.execute(
            text("PRAGMA table_info('materiales')")).fetchall()}
        if 'acabado' not in columnas:
            con.execute(text('ALTER TABLE materiales ADD COLUMN acabado VARCHAR(50)'))
        if 'cantidad_ml' not in columnas:
            con.execute(text('ALTER TABLE materiales ADD COLUMN cantidad_ml FLOAT'))
        if 'clasificacion' not in columnas:
            con.execute(text('ALTER TABLE materiales ADD COLUMN clasificacion VARCHAR(30)'))

        actualizadas = 0
        for categoria, clasificacion in mapeo_clasificacion.items():
            resultado = con.execute(text(
                'UPDATE materiales SET clasificacion = :cl '
                "WHERE categoria = :cat AND (clasificacion IS NULL OR clasificacion = '')"),
                {'cl': clasificacion, 'cat': categoria})
            actualizadas += resultado.rowcount or 0
        print(f'[migración] materiales.clasificacion poblada: '
              f'{actualizadas} fila(s) actualizada(s)')

def _migrar_pedido_columnas():
    """Agrega los campos nuevos de Pedido si la base existente no los tiene."""
    with db.engine.begin() as con:
        columnas = {
            fila[1]
            for fila in con.execute(
                text("PRAGMA table_info('pedidos')")
            ).fetchall()
        }

        if 'orden_compra' not in columnas:
            con.execute(
                text('ALTER TABLE pedidos ADD COLUMN orden_compra VARCHAR(100)')
            )
        if 'fecha_emision' not in columnas:
            con.execute(
                text('ALTER TABLE pedidos ADD COLUMN fecha_emision DATETIME')
            )
        if 'fecha_modificacion' not in columnas:
            con.execute(
                text('ALTER TABLE pedidos ADD COLUMN fecha_modificacion DATETIME')
            )
        if 'url_factura' not in columnas:
            con.execute(text('ALTER TABLE pedidos ADD COLUMN url_factura VARCHAR(255)'))


def _migrar_catalogo_imagen():
    """catalogo_productos: agrega la columna imagen_referencia (nombre del
    archivo de referencia adjunto) si la base existente no la tiene."""
    with db.engine.begin() as con:
        columnas = {fila[1] for fila in con.execute(
            text("PRAGMA table_info('catalogo_productos')")).fetchall()}
        if 'imagen_referencia' in columnas:
            print('[migración] catalogo_productos.imagen_referencia ya existe')
            return
        con.execute(text(
            'ALTER TABLE catalogo_productos ADD COLUMN imagen_referencia VARCHAR(255)'))
        total = con.execute(text(
            'SELECT COUNT(*) FROM catalogo_productos')).scalar()
        print(f'[migración] catalogo_productos.imagen_referencia agregada: '
              f'{total} fila(s) en la tabla (todas quedan sin imagen)')


def _migrar_pedido_item_columnas():
    """pedido_items: agrega estado_item (default 'pendiente') y fecha_estado
    si la base existente no las tiene. SQLite puebla el DEFAULT en todas las
    filas ya existentes al agregar la columna, así que no hace falta un
    UPDATE aparte para dejarlas en 'pendiente'."""
    with db.engine.begin() as con:
        columnas = {fila[1] for fila in con.execute(
            text("PRAGMA table_info('pedido_items')")).fetchall()}
        if 'estado_item' in columnas and 'fecha_estado' in columnas:
            print('[migración] pedido_items.estado_item/fecha_estado ya existen')
            return
        if 'estado_item' not in columnas:
            con.execute(text(
                "ALTER TABLE pedido_items ADD COLUMN estado_item VARCHAR(20) DEFAULT 'pendiente'"))
        if 'fecha_estado' not in columnas:
            con.execute(text(
                'ALTER TABLE pedido_items ADD COLUMN fecha_estado DATETIME'))
        total = con.execute(text(
            'SELECT COUNT(*) FROM pedido_items')).scalar()
        print(f'[migración] pedido_items: estado_item/fecha_estado agregadas — '
              f'{total} fila(s) migrada(s), todas en estado "pendiente"')


def _migrar_pedido_item_observacion():
    """pedido_items: agrega la columna observacion (motivo de suspensión) si
    la base existente no la tiene."""
    with db.engine.begin() as con:
        columnas = {fila[1] for fila in con.execute(
            text("PRAGMA table_info('pedido_items')")).fetchall()}
        if 'observacion' in columnas:
            print('[migración] pedido_items.observacion ya existe')
            return
        con.execute(text(
            'ALTER TABLE pedido_items ADD COLUMN observacion TEXT'))
        total = con.execute(text(
            'SELECT COUNT(*) FROM pedido_items')).scalar()
        print(f'[migración] pedido_items.observacion agregada — '
              f'{total} fila(s) en la tabla (todas sin observación)')


def _migrar_pedido_item_modo_parcial():
    """pedido_items: agrega modo_entregas_parciales (BOOLEAN, default 0) si la
    base existente no la tiene. SQLite puebla el DEFAULT en todas las filas ya
    existentes al agregar la columna, así que quedan en 0 (modo apagado)."""
    with db.engine.begin() as con:
        columnas = {fila[1] for fila in con.execute(
            text("PRAGMA table_info('pedido_items')")).fetchall()}
        if 'modo_entregas_parciales' in columnas:
            print('[migración] pedido_items.modo_entregas_parciales ya existe')
            return
        con.execute(text(
            'ALTER TABLE pedido_items ADD COLUMN modo_entregas_parciales '
            'BOOLEAN DEFAULT 0'))
        total = con.execute(text(
            'SELECT COUNT(*) FROM pedido_items')).scalar()
        print(f'[migración] pedido_items.modo_entregas_parciales agregada — '
              f'{total} fila(s) migrada(s), todas con el modo apagado')


def _migrar_catalogo_tipo_codigo():
    """catalogo_productos: agrega tipo_codigo (default 'normal') si la base
    existente no la tiene. SQLite puebla el DEFAULT en todas las filas ya
    existentes al agregar la columna."""
    with db.engine.begin() as con:
        columnas = {fila[1] for fila in con.execute(
            text("PRAGMA table_info('catalogo_productos')")).fetchall()}
        if 'tipo_codigo' in columnas:
            print('[migración] catalogo_productos.tipo_codigo ya existe')
            return
        con.execute(text(
            "ALTER TABLE catalogo_productos ADD COLUMN tipo_codigo VARCHAR(10) DEFAULT 'normal'"))
        total = con.execute(text(
            'SELECT COUNT(*) FROM catalogo_productos')).scalar()
        print(f'[migración] catalogo_productos.tipo_codigo agregada — '
              f'{total} fila(s) migrada(s), todas en tipo "normal"')


def _migrar_catalogo_codigo_sin_codigo():
    """Permite varios productos con código '-' por cliente y mantiene única
    la pareja (codigo, cliente) para los demás códigos. SQLite no puede quitar
    una constraint de tabla, así que reconstruye la tabla conservando sus
    filas y convirtiendo códigos nulos/vacíos existentes a '-'."""
    with db.engine.begin() as con:
        indices = con.execute(
            text("PRAGMA index_list('catalogo_productos')")).fetchall()
        tiene_indice_parcial = False
        tiene_unique_viejo = False
        for indice in indices:
            # index_list: (seq, name, unique, origin, partial)
            if indice[2]:
                columnas = con.execute(
                    text(f"PRAGMA index_info('{indice[1]}')")).fetchall()
                campos = [c[2] for c in columnas]
                if campos in (['codigo'], ['codigo', 'cliente']) and not indice[4]:
                    tiene_unique_viejo = True
                if (indice[1] == 'uq_catalogo_codigo_cliente' and indice[4]
                        and campos == ['codigo', 'cliente']):
                    tiene_indice_parcial = True
        if tiene_indice_parcial and not tiene_unique_viejo:
            codigos_vacios = con.execute(text(
                "SELECT EXISTS (SELECT 1 FROM catalogo_productos "
                "WHERE codigo IS NULL OR TRIM(codigo) = '')"
            )).scalar()
            if not codigos_vacios:
                return

        # En el modo legacy de sqlite3, DDL no inicia una transacción real.
        # BEGIN explícito permite revertir también RENAME/CREATE/DROP si falla.
        if not con.connection.driver_connection.in_transaction:
            con.exec_driver_sql('BEGIN IMMEDIATE')
        antes = con.execute(
            text('SELECT COUNT(*) FROM catalogo_productos')).scalar()
        nombres_columnas = [c.name for c in ProductoCatalogo.__table__.columns]
        columnas = ', '.join(nombres_columnas)
        valores = ', '.join(
            "CASE WHEN codigo IS NULL OR TRIM(codigo) = '' "
            "THEN '-' ELSE codigo END" if nombre == 'codigo' else nombre
            for nombre in nombres_columnas
        )
        con.execute(text(
            'ALTER TABLE catalogo_productos '
            'RENAME TO catalogo_productos_viejo'))
        for indice in indices:
            if indice[1] == 'uq_catalogo_codigo_cliente' and indice[3] == 'c':
                con.execute(text('DROP INDEX uq_catalogo_codigo_cliente'))
        ProductoCatalogo.__table__.create(bind=con)
        con.execute(text(
            f'INSERT INTO catalogo_productos ({columnas}) '
            f'SELECT {valores} FROM catalogo_productos_viejo'))
        despues = con.execute(
            text('SELECT COUNT(*) FROM catalogo_productos')).scalar()
        if antes != despues:
            raise RuntimeError(
                f'Migración de códigos del catálogo abortada: {antes} filas '
                f'antes y {despues} después — se revierte todo')
        con.execute(text('DROP TABLE catalogo_productos_viejo'))
        print(f'[migración] catálogo: códigos "-" repetibles por cliente; '
              f'{despues} filas conservadas')


def _migrar_cliente_logo():
    """clientes_db: agrega la columna logo_filename (nombre del archivo en
    uploads/logos/) si la base existente no la tiene."""
    with db.engine.begin() as con:
        columnas = {fila[1] for fila in con.execute(
            text("PRAGMA table_info('clientes_db')")).fetchall()}
        if 'logo_filename' in columnas:
            print('[migración] clientes_db.logo_filename ya existe')
            return
        con.execute(text(
            'ALTER TABLE clientes_db ADD COLUMN logo_filename VARCHAR(150)'))
        total = con.execute(text(
            'SELECT COUNT(*) FROM clientes_db')).scalar()
        print(f'[migración] clientes_db.logo_filename agregada — '
              f'{total} fila(s) en la tabla (todas sin logo)')


def _migrar_entrega_parcial_items():
    """entrega_parcial_items: crea la tabla de movimientos de entrega parcial
    por ítem si la base existente no la tiene. db.create_all() ya la crea en
    bases nuevas; esto cubre bases viejas y deja la migración explícita e
    idempotente (verifica sqlite_master antes de crear)."""
    with db.engine.begin() as con:
        existe = con.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name='entrega_parcial_items'")).fetchone()
        if existe:
            print('[migración] entrega_parcial_items ya existe')
            return
        EntregaParcialItem.__table__.create(bind=con)
        print('[migración] entrega_parcial_items creada')


def _migrar_pedido_item_estado_previo():
    """pedido_items: agrega la columna estado_item_previo (nullable) si la base
    existente no la tiene. Guarda el estado_item previo a un retroceso de pedido
    para poder restaurarlo. Idempotente: verifica PRAGMA antes de alterar."""
    with db.engine.begin() as con:
        columnas = {fila[1] for fila in con.execute(
            text("PRAGMA table_info('pedido_items')")).fetchall()}
        if 'estado_item_previo' in columnas:
            print('[migración] pedido_items.estado_item_previo ya existe')
            return
        con.execute(text(
            'ALTER TABLE pedido_items ADD COLUMN estado_item_previo VARCHAR(20)'))
        total = con.execute(text(
            'SELECT COUNT(*) FROM pedido_items')).scalar()
        print(f'[migración] pedido_items.estado_item_previo agregada — '
              f'{total} fila(s) en la tabla (todas sin previo)')


def _migrar_pedido_observacion_retroceso():
    """pedidos: agrega la columna observacion_retroceso (Text nullable) si la
    base existente no la tiene. Guarda el motivo del último retroceso de estado.
    Idempotente: verifica PRAGMA antes de alterar."""
    with db.engine.begin() as con:
        columnas = {fila[1] for fila in con.execute(
            text("PRAGMA table_info('pedidos')")).fetchall()}
        if 'observacion_retroceso' in columnas:
            print('[migración] pedidos.observacion_retroceso ya existe')
            return
        con.execute(text(
            'ALTER TABLE pedidos ADD COLUMN observacion_retroceso TEXT'))
        total = con.execute(text(
            'SELECT COUNT(*) FROM pedidos')).scalar()
        print(f'[migración] pedidos.observacion_retroceso agregada — '
              f'{total} fila(s) en la tabla (todas sin observación)')


def _migrar_catalogo_planificacion():
    """catalogo_productos: agrega tiempo_base_minutos y maquina_requerida si no existen.
    También marca códigos especiales conocidos (ej. 90006718) con maquina_requerida='Mesp'."""
    with db.engine.begin() as con:
        columnas = {fila[1] for fila in con.execute(
            text("PRAGMA table_info('catalogo_productos')")).fetchall()}
        if 'tiempo_base_minutos' not in columnas:
            con.execute(text('ALTER TABLE catalogo_productos ADD COLUMN tiempo_base_minutos FLOAT DEFAULT 1.0'))
            print('[migración] catalogo_productos.tiempo_base_minutos agregada')
        if 'maquina_requerida' not in columnas:
            con.execute(text('ALTER TABLE catalogo_productos ADD COLUMN maquina_requerida VARCHAR(50)'))
            print('[migración] catalogo_productos.maquina_requerida agregada')

        # Asignar máquina 'Mesp' a códigos especiales (como 90006718 o tipo_codigo='especial')
        con.execute(text("UPDATE catalogo_productos SET maquina_requerida = 'Mesp' WHERE (codigo = '90006718' OR tipo_codigo = 'especial') AND (maquina_requerida IS NULL OR maquina_requerida = '')"))
        # Asegurar tiempo base por defecto para filas existentes con NULL
        con.execute(text("UPDATE catalogo_productos SET tiempo_base_minutos = 1.0 WHERE tiempo_base_minutos IS NULL"))


def _migrar_pedido_planificacion():
    """pedidos: agrega maquina_asignada, fecha_inicio_produccion, fecha_fin_produccion, minutos_estimados si no existen."""
    with db.engine.begin() as con:
        columnas = {fila[1] for fila in con.execute(
            text("PRAGMA table_info('pedidos')")).fetchall()}
        if 'maquina_asignada' not in columnas:
            con.execute(text('ALTER TABLE pedidos ADD COLUMN maquina_asignada VARCHAR(50)'))
            print('[migración] pedidos.maquina_asignada agregada')
        if 'fecha_inicio_produccion' not in columnas:
            con.execute(text('ALTER TABLE pedidos ADD COLUMN fecha_inicio_produccion DATETIME'))
            print('[migración] pedidos.fecha_inicio_produccion agregada')
        if 'fecha_fin_produccion' not in columnas:
            con.execute(text('ALTER TABLE pedidos ADD COLUMN fecha_fin_produccion DATETIME'))
            print('[migración] pedidos.fecha_fin_produccion agregada')
        if 'minutos_estimados' not in columnas:
            con.execute(text('ALTER TABLE pedidos ADD COLUMN minutos_estimados FLOAT DEFAULT 0.0'))
            print('[migración] pedidos.minutos_estimados agregada')


def _migrar_permisos_y_origen_movimientos():
    """Columnas aditivas; serializar también el chequeo con varios workers."""
    import re
    with db.engine.begin() as con:
        con.execute(text('BEGIN IMMEDIATE'))
        columnas = {fila[1] for fila in con.execute(text('PRAGMA table_info(usuarios)'))}
        if 'permisos_json' not in columnas:
            con.execute(text('ALTER TABLE usuarios ADD COLUMN permisos_json TEXT'))
        columnas = {fila[1] for fila in con.execute(text('PRAGMA table_info(movimientos)'))}
        if 'pedido_origen_id' not in columnas:
            con.execute(text('ALTER TABLE movimientos ADD COLUMN pedido_origen_id INTEGER'))
            # Los registros antiguos solo tenían una descripción. Reconocer
            # exclusivamente los dos prefijos exactos generados por el sistema.
            for fila in con.execute(text('SELECT id, observacion FROM movimientos')):
                origen = re.match(r'^(?:Descuento automático|Reversión automática) pedido #(\d+) \(', fila.observacion or '')
                if origen:
                    con.execute(text('UPDATE movimientos SET pedido_origen_id=:pedido WHERE id=:id'),
                                {'pedido': int(origen[1]), 'id': fila.id})
        con.execute(text('CREATE INDEX IF NOT EXISTS ix_movimientos_pedido_origen_id ON movimientos (pedido_origen_id)'))


