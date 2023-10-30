import { FaucetConfigContext, FaucetPageContext } from '../FaucetPage';
import React, { useContext } from 'react';
import { IFaucetConfig } from '../../common/FaucetConfig';
import { FaucetCaptcha } from '../shared/FaucetCaptcha';

import './ZupassLogin.css';
import { toQuery } from '../../utils/QueryUtils';
import { TypedEmitter } from 'tiny-typed-emitter';
import { FaucetTime } from '../../common/FaucetTime';
import { IFaucetContext } from '../../common/FaucetContext';

import { EdDSATicketPCDPackage } from "@pcd/eddsa-ticket-pcd";
import { SemaphoreIdentityPCDPackage } from "@pcd/semaphore-identity-pcd";
import { ArgumentTypeName } from "@pcd/pcd-types";
import { ArgsOf, PCDPackage, SerializedPCD } from "@pcd/pcd-types";
import {
  EdDSATicketFieldsToReveal,
  ZKEdDSAEventTicketPCD,
  ZKEdDSAEventTicketPCDArgs,
  ZKEdDSAEventTicketPCDPackage
} from "@pcd/zk-eddsa-event-ticket-pcd";
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { IZupassLogin } from './ZupassLoginInterface';

export interface IZupassLoginProps {
  faucetContext: IFaucetContext;
  faucetConfig: IFaucetConfig;
  forwardRef: React.RefObject<IZupassLogin>;
}

export interface IZupassLoginState {
  popupOpen: boolean;
  authInfo: IZupassAuthInfo;
}

export interface IZupassAuthInfo {
  ticketId: string;
  productId: string;
  eventId: string;
  attendeeId: string;
  token: string;
}

export enum PCDRequestType {
  Get = "Get",
  GetWithoutProving = "GetWithoutProving",
  Add = "Add",
  ProveAndAdd = "ProveAndAdd"
}

export interface PCDRequest {
  returnUrl: string;
  type: PCDRequestType;
}

export interface ProveOptions {
  genericProveScreen?: boolean;
  title?: string;
  description?: string;
  debug?: boolean;
  proveOnServer?: boolean;
  signIn?: boolean;
}

/**
 * When a website uses the Zupass for signing in, Zupass
 * signs this payload using a `SemaphoreSignaturePCD`.
 */
export interface SignInMessagePayload {
  uuid: string;
  referrer: string;
}

export interface PCDGetRequest<T extends PCDPackage = PCDPackage>
  extends PCDRequest {
  type: PCDRequestType.Get;
  pcdType: T["name"];
  args: ArgsOf<T>;
  options?: ProveOptions;
}

export class ZupassLogin extends React.PureComponent<IZupassLoginProps, IZupassLoginState> {
  private messageEvtListener: (evt: MessageEvent) => void;
  private loginPopop: Window;

  constructor(props: IZupassLoginProps, state: IZupassLoginState) {
    super(props);
    (this.props.forwardRef as any).current = this;

    this.messageEvtListener = (evt: MessageEvent) => this.processWindowMessage(evt);

    this.state = {
      popupOpen: false,
      authInfo: null,
		};
  }

  public componentDidMount() {
    window.addEventListener("message", this.messageEvtListener);
    if(localStorage['zupass.AuthResult']) {
      try {
        this.processLoginResult(JSON.parse(localStorage['zupass.AuthResult']));
        localStorage.removeItem("zupass.AuthResult");
      } catch(ex) {
        console.error("error parsing auth result from localstorage: ", ex);
      }
    }
    else if(localStorage['zupass.AuthInfo']) {
      try {
        let authInfo = JSON.parse(localStorage['zupass.AuthInfo']);
        this.loadAuthInfo(authInfo);
      } catch(ex) {
        console.error("error parsing auth info from localstorage: ", ex);
      }
    }

  }

  public componentWillUnmount() {
    window.removeEventListener("message", this.messageEvtListener);
    this.loginPopop = null;
  }

	public render(): React.ReactElement {

    return (
      <div className='faucet-auth faucet-zupass-auth'>
        <div className='auth-icon'>
          <div className='logo logo-zupass' style={{backgroundImage: "url('/images/devconnect-ist.png')"}}></div>
        </div>
        {this.state.authInfo ?
          this.renderLoginState() :
          this.renderLoginButton()
        }
      </div>
    );
	}

  private renderLoginButton(): React.ReactElement {
    return (
      <div className='auth-field auth-noauth' onClick={(evt) => this.onLoginClick()}>
        <div>DevConnect attendee? Login with your Ticket.</div>
        <div>
          <a href="#" onClick={(evt) => evt.preventDefault()}>
            {this.state.popupOpen ?
              <span className='inline-spinner'>
                <img src="/images/spinner.gif" className="spinner" />
              </span>
            : null}
            Login with Zupass
          </a>
        </div>
      </div>
    );
  }

  private renderLoginState(): React.ReactElement {
    return (
      <div className='auth-field auth-profile'>
        <div className='auth-info'>
          Authenticated with Zupass identity 
          <OverlayTrigger
            placement="bottom"
            delay={{ show: 250, hide: 400 }}
            overlay={(props) => this.renderZupassTicketInfo(this.state.authInfo, props)}
          >
            <span className="auth-ident-truncated">{this.state.authInfo.attendeeId}</span>
          </OverlayTrigger>
        </div>
        <div>
          <a href="#" onClick={(evt) => {evt.preventDefault(); this.onLogoutClick()}}>
            Logout
          </a>
        </div>
      </div>
    );
  }

  private renderZupassTicketInfo(ticketInfo: IZupassAuthInfo, props: any): React.ReactElement {
    if(!ticketInfo)
      return null;
    
    return (
      <Tooltip id="zupass-tooltip" {...props}>
        <div className='zupass-info'>
          <table>
            <tbody>
              <tr>
                <td className='zupass-title'>TicketId:</td>
                <td className='zupass-value'>{ticketInfo.ticketId}</td>
              </tr>
              <tr>
                <td className='zupass-title'>EventId:</td>
                <td className='zupass-value'>{ticketInfo.eventId}</td>
              </tr>
              <tr>
                <td className='zupass-title'>ProductId:</td>
                <td className='zupass-value'>{ticketInfo.productId}</td>
              </tr>
              <tr>
                <td className='zupass-title'>Attendee:</td>
                <td className='zupass-value'>{ticketInfo.attendeeId}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Tooltip>
    );
  }

  public getToken(): string {
    return this.state.authInfo?.token;
  }
  
  private onLoginClick() {

    const args: ZKEdDSAEventTicketPCDArgs = {
      ticket: {
        argumentType: ArgumentTypeName.PCD,
        pcdType: EdDSATicketPCDPackage.name,
        value: undefined,
        userProvided: true,
        validatorParams: {
          eventIds: this.props.faucetConfig.modules.zupass.event.eventIds,
          productIds: this.props.faucetConfig.modules.zupass.event.productIds,
          notFoundMessage: "No eligible PCDs found"
        }
      },
      identity: {
        argumentType: ArgumentTypeName.PCD,
        pcdType: SemaphoreIdentityPCDPackage.name,
        value: undefined,
        userProvided: true
      },
      validEventIds: {
        argumentType: ArgumentTypeName.StringArray,
        value: this.props.faucetConfig.modules.zupass.event.eventIds.length != 0 ? this.props.faucetConfig.modules.zupass.event.eventIds : undefined,
        userProvided: false
      },
      fieldsToReveal: {
        argumentType: ArgumentTypeName.ToggleList,
        value: {
          revealTicketId: true,
          revealEventId: true,
          revealAttendeeSemaphoreId: true,
          revealProductId: true,
        },
        userProvided: false
      },
      externalNullifier: {
        argumentType: ArgumentTypeName.BigInt,
        value: this.props.faucetConfig.modules.zupass.nullifier,
        userProvided: false
      },
      watermark: {
        argumentType: ArgumentTypeName.BigInt,
        value: this.props.faucetConfig.modules.zupass.watermark,
        userProvided: false
      }
    };

    const req: PCDGetRequest<typeof ZKEdDSAEventTicketPCDPackage> = {
      type: PCDRequestType.Get,
      returnUrl: this.props.faucetConfig.modules.zupass.redirectUrl || this.props.faucetContext.faucetApi.getApiUrl("/zupassCallback", true),
      args: args,
      pcdType: "zk-eddsa-event-ticket-pcd",
      options: {
        genericProveScreen: true,
        title: "ZKEdDSA Proof",
        description: "zkeddsa ticket pcd request"
      }
    };
    const encReq = encodeURIComponent(JSON.stringify(req));
    let url = `${this.props.faucetConfig.modules.zupass.url}#/prove?request=${encReq}`;

    this.loginPopop = window.open(url, "_blank", "width=450,height=600,top=100,popup");

    if(!this.state.popupOpen) {
      this.setState({
        popupOpen: true,
      }, () => {
        this.pollPopupState();
      });
    }
  }
  
  private onLogoutClick() {
    localStorage.removeItem("zupass.AuthInfo");
    this.setState({
      authInfo: null,
    });
  }


  private pollPopupState() {
    if(!this.loginPopop)
      return;
    
    if(!this.state.popupOpen)
      return;
    if(this.loginPopop.closed) {
      this.setState({
        popupOpen: false,
      });
      this.loginPopop = null;
    }
    else {
      setTimeout(() => this.pollPopupState(), 1000);
    }
  }

  private processWindowMessage(evt: MessageEvent) {
    if(!evt.data || typeof evt.data !== "object" || evt.data.authModule !== "zupass" || !evt.data.authResult)
      return;
    this.processLoginResult(evt.data.authResult);
  }

  private processLoginResult(authResult: any) {
    console.log("Zupass auth: ", authResult);
    if(this.loginPopop)
      this.loginPopop.close();
    if(authResult.data) {
      this.loadAuthInfo(authResult.data);
      localStorage['zupass.AuthInfo'] = JSON.stringify(authResult.data);
    }
    else if(authResult.errorCode) {
      this.props.faucetContext.showDialog({
        title: "Could not authenticate with zupass",
        body: (<div className='alert alert-danger'>[{authResult.errorCode}] {authResult.errorMessage}</div>),
        closeButton: { caption: "Close" },
      });
    }
  }

  private loadAuthInfo(authInfo: IZupassAuthInfo) {
    this.setState({
      authInfo: authInfo,
    });
  }

}

export default (props) => {
  return (
    <ZupassLogin 
      {...props}
    />
  );
};
