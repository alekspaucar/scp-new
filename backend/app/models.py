from datetime import datetime
from hashlib import sha256
import pytz
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import UserMixin
from .extensions import db

def hora_ecuador():
    tz = pytz.timezone('America/Guayaquil')
    return datetime.now(tz).replace(tzinfo=None)

class Usuario(UserMixin, db.Model):
    __tablename__ = 'usuarios'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    rol = db.Column(db.String(20), nullable=False, default='admin')
    # NULL conserva los permisos originales del rol; JSON permite personalizarlos.
    permisos_json = db.Column(db.Text, nullable=True)
    # Valores válidos de rol: 'admin', 'jefe', 'empleado', 'operador'

    def get_id(self):
        # The salted password hash identifies this account incarnation. An old
        # cookie must not survive ID reuse or a password reset.
        digest = sha256(self.password_hash.encode('utf-8')).hexdigest()
        return f'{self.id}:{digest}'

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Material(db.Model):
    __tablename__ = 'materiales'
    id = db.Column(db.Integer, primary_key=True)
    revision = db.Column(db.Integer, nullable=False, default=1, server_default='1')
    __mapper_args__ = {'version_id_col': revision}
    codigo_barras = db.Column(db.String(100), unique=True, nullable=False)
    nombre = db.Column(db.String(200), nullable=False)
    categoria = db.Column(db.String(50), nullable=False)
    # Categorías válidas: 'Materia Prima', 'Tintas', 'Herramientas'
    tipo = db.Column(db.String(50), default='Sustrato')
    # Tipos válidos: 'Sustrato', 'Tinta', 'Cinta'
    metros_por_rollo = db.Column(db.Float, default=0)  # solo informativo
    stock_actual = db.Column(db.Integer, default=0)    # EN ROLLOS
    stock_minimo = db.Column(db.Integer, default=0)    # EN ROLLOS
    stock_critico = db.Column(db.Integer, default=0)   # = stock_minimo
    estado = db.Column(db.String(20), default='Disponible')
    unidad_medida = db.Column(db.String(20), default='rollos')
    color = db.Column(db.String(50))
    capacidad = db.Column(db.String(50))
    gramaje = db.Column(db.String(50))
    proveedor = db.Column(db.String(150))
    ancho_material_cm = db.Column(db.Float)
    acabado = db.Column(db.String(50))          # solo Materia Prima
    cantidad_ml = db.Column(db.Float)           # reservada — solo Tintas
    clasificacion = db.Column(db.String(30))    # automático, derivado de categoria

class Movimiento(db.Model):
    __tablename__ = 'movimientos'
    id = db.Column(db.Integer, primary_key=True)
    material_id = db.Column(db.Integer, db.ForeignKey('materiales.id'),
                            nullable=False)
    material = db.relationship('Material')
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'))
    usuario = db.relationship('Usuario')
    tipo_movimiento = db.Column(db.String(10), nullable=False)
    # Valores válidos: 'Entrada', 'Salida'
    cantidad = db.Column(db.Integer, nullable=False)   # EN ROLLOS
    fecha = db.Column(db.DateTime, default=hora_ecuador)
    observacion = db.Column(db.String(300))
    # Identificador de origen histórico; se conserva si se elimina el pedido.
    pedido_origen_id = db.Column(db.Integer, nullable=True, index=True)

class Pedido(db.Model):
    __tablename__ = 'pedidos'
    id = db.Column(db.Integer, primary_key=True)
    revision = db.Column(db.Integer, nullable=False, default=1, server_default='1')
    __mapper_args__ = {'version_id_col': revision}
    cliente = db.Column(db.String(150), nullable=False)
    fecha_entrega = db.Column(db.String(50))
    
    # agregado por codex : fecha_entrega se mantiene como String para permitir formatos flexibles 
    orden_compra = db.Column(db.String(100), nullable=False)
    fecha_emision = db.Column(db.DateTime, default=hora_ecuador, nullable=False)
    fecha_modificacion = db.Column(
        db.DateTime, default=hora_ecuador, onupdate=hora_ecuador, nullable=False
    )
    estado = db.Column(db.String(20), default='En Cola')
    # Estados válidos: 'En Cola', 'Procesando', 'Terminado',
    # 'Retiro en Fábrica', 'Entregado'
    total_items = db.Column(db.Integer, default=0)
    total_unidades = db.Column(db.Integer, default=0)
    fecha_entregado = db.Column(db.DateTime)
    # Motivo del último retroceso de estado (obligatorio al regresar el pedido)
    observacion_retroceso = db.Column(db.Text, nullable=True)
    url_factura = db.Column(db.String(255), nullable=True)
    # ── Planificación Gráfica 24/7 (Paso 5) ──
    maquina_asignada = db.Column(db.String(50), nullable=True)  # 'M1', 'M2', 'Mesp'
    fecha_inicio_produccion = db.Column(db.DateTime, nullable=True)
    fecha_fin_produccion = db.Column(db.DateTime, nullable=True)
    minutos_estimados = db.Column(db.Float, default=0.0, nullable=True)
    items = db.relationship('PedidoItem', backref='pedido',
                            cascade='all, delete-orphan', lazy=True)

class PedidoItem(db.Model):
    __tablename__ = 'pedido_items'
    id = db.Column(db.Integer, primary_key=True)
    pedido_id = db.Column(db.Integer, db.ForeignKey('pedidos.id'),
                          nullable=False)
    codigo = db.Column(db.String(100), default='S/C')
    descripcion = db.Column(db.String(300))
    cantidad = db.Column(db.Integer, default=0)
    estado_item = db.Column(db.String(20), default='pendiente')
    # Valores válidos: 'pendiente', 'listo', 'suspendido', 'entregado_parcial'
    # estado_item guardado justo antes de un retroceso de pedido, para restaurar
    estado_item_previo = db.Column(db.String(20), nullable=True)
    fecha_estado = db.Column(db.DateTime)  # cuándo cambió de estado
    observacion = db.Column(db.Text)  # motivo, obligatorio solo si suspendido
    # Cuando True, este ítem se despacha por cantidades parciales: la UI muestra
    # la sección de entregas y el progreso cuenta la fracción entregada. Una vez
    # activado no se puede desactivar (ver endpoint .../modo-parcial).
    modo_entregas_parciales = db.Column(db.Boolean, default=False)
    entregas = db.relationship('EntregaParcialItem', backref='item',
                               cascade='all, delete-orphan',
                               order_by='EntregaParcialItem.fecha')
    faltantes = db.relationship('ReporteFaltante', backref='item',
                                cascade='all, delete-orphan',
                                order_by='ReporteFaltante.fecha.desc()')

class EntregaParcialItem(db.Model):
    """Movimiento de entrega parcial por cantidad de un ítem de pedido. Cada
    fila es una salida de N unidades; la suma de todas las entregas de un ítem
    marca cuánto se ha despachado de las item.cantidad pedidas."""
    __tablename__ = 'entrega_parcial_items'
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('pedido_items.id'),
                        nullable=False)
    cantidad_entregada = db.Column(db.Integer, nullable=False)
    fecha = db.Column(db.DateTime, default=hora_ecuador)
    observacion = db.Column(db.Text, nullable=True)

class ReporteFaltante(db.Model):
    """Canal de comunicación Pre-acabados (Corte ↔ Impresión).
    Registra alertas en tiempo real de mermas o faltantes de planchas/etiquetas
    que Corte necesita que Impresión reponga antes de completar el pedido."""
    __tablename__ = 'reportes_faltantes'
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('pedido_items.id'), nullable=False)
    cantidad_faltante = db.Column(db.Integer, nullable=False)
    unidad = db.Column(db.String(20), default='etiquetas')  # 'etiquetas' o 'planchas'
    departamento_origen = db.Column(db.String(50), default='Corte')
    motivo = db.Column(db.String(300), nullable=True)
    resuelto = db.Column(db.Boolean, default=False)
    fecha = db.Column(db.DateTime, default=hora_ecuador)
    fecha_resolucion = db.Column(db.DateTime, nullable=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=True)

class ProductoCatalogo(db.Model):
    __tablename__ = 'catalogo_productos'
    id = db.Column(db.Integer, primary_key=True)
    codigo = db.Column(db.String(100), nullable=False)
    cliente = db.Column(db.String(150))
    descripcion = db.Column(db.String(300), nullable=False)
    cant_etiquetas_plancha = db.Column(db.Integer, default=0)
    cant_planchas = db.Column(db.Integer, default=0)
    cant_rollos = db.Column(db.Integer, default=0)
    cant_etiquetas_rollo = db.Column(db.Integer, default=0)
    largo_plancha_impresa = db.Column(db.Float, default=0)
    largo_rollo = db.Column(db.Float, default=0)
    ancho_rollo = db.Column(db.Float, default=0)
    material_id = db.Column(db.Integer,
                            db.ForeignKey('materiales.id'), nullable=True)
    material = db.relationship('Material')
    imagen_referencia = db.Column(db.String(255))  # nombre del archivo adjunto
    tipo_codigo = db.Column(db.String(10), default='normal')
    # valores: 'normal' o 'especial'
    # ── Planificación Gráfica y Asignación (Paso 5) ──
    tiempo_base_minutos = db.Column(db.Float, default=1.0)  # tiempo que toma producir una unidad/plancha
    maquina_requerida = db.Column(db.String(50), nullable=True)  # ej: 'Mesp' para códigos especiales como 90006718

    # El mismo código puede repetirse para clientes distintos; los productos
    # sin código usan '-' y pueden repetirse para el mismo cliente.
    __table_args__ = (
        db.Index(
            'uq_catalogo_codigo_cliente', 'codigo', 'cliente', unique=True,
            sqlite_where=db.text("codigo != '-'")
        ),
    )

class Cliente(db.Model):
    __tablename__ = 'clientes_db'
    id = db.Column(db.Integer, primary_key=True)
    codigo = db.Column(db.String(50), unique=True, nullable=False)
    nombre = db.Column(db.String(150), nullable=False)
    ruc = db.Column(db.String(20))
    direccion_facturacion = db.Column(db.String(250))
    direccion_entrega = db.Column(db.String(250))
    contacto_principal = db.Column(db.String(150))
    horarios_entrega = db.Column(db.String(150))
    plazos_entrega = db.Column(db.String(150))
    logo_filename = db.Column(db.String(150))  # nombre del archivo en uploads/logos/


@event.listens_for(Session, 'before_flush')
def _versionar_pedido_por_cambios_hijos(session, flush_context, instances):
    """Child history participates in the parent's optimistic write lock."""
    pedidos = set()
    with session.no_autoflush:
        for obj in set(session.new) | set(session.dirty) | set(session.deleted):
            if obj in session.dirty and not session.is_modified(obj, include_collections=True):
                continue
            if isinstance(obj, PedidoItem):
                pedido = obj.pedido or session.get(Pedido, obj.pedido_id)
            elif isinstance(obj, (EntregaParcialItem, ReporteFaltante)):
                item = obj.item or session.get(PedidoItem, obj.item_id)
                pedido = item.pedido if item is not None else None
            else:
                continue
            if pedido is not None and inspect(pedido).persistent and pedido not in session.deleted:
                pedidos.add(pedido)
        for pedido in pedidos:
            # SQLAlchemy uses the original revision in the UPDATE predicate;
            # an independent stale session raises StaleDataError at flush.
            pedido.revision += 1

def _actualizar_estado(material):
    if material.stock_actual <= 0:
        material.estado = 'Agotado'
    elif material.stock_actual <= material.stock_critico:
        material.estado = 'Crítico'
    elif material.stock_actual <= material.stock_minimo:
        material.estado = 'Bajo'
    else:
        material.estado = 'Disponible'
