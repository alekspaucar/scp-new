from ipaddress import ip_address
from urllib.parse import urlsplit
from flask import Blueprint, request, jsonify, session
from flask_login import login_user, logout_user, login_required, current_user
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from ..extensions import db
from ..models import Usuario
from ..permisos import usuario_a_dict

auth_bp = Blueprint('auth', __name__)

def _loopback(value):
    if value == 'localhost':
        return True
    try:
        return ip_address(value or '').is_loopback
    except ValueError:
        return False


@auth_bp.get('/api/health')
def health():
    return jsonify({'status': 'ok', 'proyecto': 'sgp-nueva-interfaz'})


@auth_bp.get('/api/instalacion')
def estado_instalacion():
    return jsonify({'requiere_configuracion': Usuario.query.first() is None})


@auth_bp.post('/api/instalacion')
def configurar_instalacion():
    # Do not trust forwarded IPs. The local Next.js proxy preserves Origin.
    origin = request.headers.get('Origin')
    try:
        local_origin = not origin or (urlsplit(origin).scheme in ('http', 'https')
                                     and _loopback(urlsplit(origin).hostname))
        host = urlsplit('http://' + request.host).hostname
    except ValueError:
        local_origin, host = False, None
    if not (_loopback(request.remote_addr) and _loopback(host) and local_origin):
        return jsonify({'error': 'La instalación inicial solo está disponible en localhost'}), 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get('username'), str) or not isinstance(data.get('password'), str):
        return jsonify({'error': 'Usuario y contraseña deben ser texto'}), 400
    username, password = data['username'].strip(), data['password']
    if not username or len(username) > 80 or len(password) < 10:
        return jsonify({'error': 'Indica un usuario de 1 a 80 caracteres y una contraseña de al menos 10 caracteres'}), 400
    user = Usuario(username=username, rol='jefe')
    user.set_password(password)
    try:
        # The empty check and insert share one writer lock across processes.
        db.session.execute(text('BEGIN IMMEDIATE'))
        if Usuario.query.first() is not None:
            db.session.rollback()
            return jsonify({'error': 'La instalación ya fue configurada'}), 409
        db.session.add(user)
        db.session.commit()
    except OperationalError:
        db.session.rollback()
        return jsonify({'error': 'Instalación ocupada; intenta nuevamente'}), 503
    session.clear()
    session.permanent = True
    login_user(user)
    return jsonify(usuario_a_dict(user)), 201

@auth_bp.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict) or not isinstance(data.get('username'), str) or not isinstance(data.get('password'), str):
        return jsonify({'error': 'Usuario y contraseña deben ser texto'}), 400
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    user = Usuario.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return jsonify({'error': 'Usuario o contraseña incorrectos'}), 401
    # Sesión permanente para que aplique PERMANENT_SESSION_LIFETIME (10 h)
    session.permanent = True
    login_user(user)
    return jsonify({'mensaje': 'Login exitoso', **usuario_a_dict(user)})


@auth_bp.route('/api/sesion', methods=['GET'])
@login_required
def sesion_actual():
    return jsonify(usuario_a_dict(current_user))

@auth_bp.route('/logout')
def logout():
    logout_user()
    return jsonify({'mensaje': 'Sesión cerrada'})

