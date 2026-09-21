# 회사 네트워크의 SSL 검사 프록시(Windows/macOS 시스템 인증서 저장소는 신뢰하지만
# Python 기본 certifi 번들에는 없는 사내 루트 CA)에서 CERTIFICATE_VERIFY_FAILED로
# 막히지 않도록, 아래 모듈들이 httpx 클라이언트를 만들기 전에 OS 인증서 저장소를
# 신뢰하도록 한 번만 설정한다.
import truststore

truststore.inject_into_ssl()
